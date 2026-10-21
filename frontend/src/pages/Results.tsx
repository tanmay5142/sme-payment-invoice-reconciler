import { useEffect, useState } from "react";
import { getReport } from "../api";
import type { Report, ReportRow } from "../api";
import { flagLabel } from "../flags";
import { money, shortDate } from "../format";

const stageLabel = {
  PAID: "Marked paid",
  APPROVED: "Approved, not applied",
  AWAITING_APPROVAL: "Waiting for approval",
  REJECTED: "Rejected",
  NOT_MATCHED: "No invoice found",
  PENDING_IN_BANK: "Pending in bank",
};
const stageClass = {
  PAID: "PAID",
  APPROVED: "PART_PAID",
  AWAITING_APPROVAL: "OPEN",
  REJECTED: "PENDING",
  NOT_MATCHED: "PENDING",
  PENDING_IN_BANK: "PART_PAID",
};

function downloadCsv(report: Report) {
  const rows = [...report.matched, ...report.partial, ...report.unmatched];
  const header = ["Category", "Bank transaction", "Bank amount", "Invoices", "Stage", "Reason"];
  const lines = rows.map((r) => [
    r.category,
    r.bankTxnId,
    r.bankAmount,
    r.invoices.map((i) => `${i.invoiceId}:${i.amount}`).join(" "),
    r.stage,
    r.reason,
  ]);
  const csv = [header, ...lines]
    .map((cols) => cols.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "reconciliation-report.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function RowCard({ r }: { r: ReportRow }) {
  return (
    <div className="approval" data-testid={`result-${r.bankTxnId}`}>
      <div className="approval-head">
        <div>
          <strong>{r.bankTxnId}</strong> · {r.description}
          <br />
          <small className="muted">
            Reference: {r.reference ?? "none"} · {shortDate(r.date)}
          </small>
        </div>
        <div className="right">
          <strong>{money(r.bankAmount)}</strong>
          <br />
          <span className={`badge ${stageClass[r.stage]}`}>{stageLabel[r.stage]}</span>
        </div>
      </div>

      {r.invoices.length > 0 && (
        <p>
          Applies to:{" "}
          {r.invoices.map((i) => `${i.invoiceId} (${money(i.amount)} of ${money(i.invoiceTotal)})`).join(", ")}
        </p>
      )}

      <p className="reason">{r.reason}</p>

      <div className="badges">
        <span className={`badge conf-${r.confidence}`}>{r.confidence} confidence</span>
        <span className="flag">Decided by {r.source === "AI" ? "AI agent" : r.source === "RULES" ? "rules" : "nobody yet"}</span>
        {r.flags.map((f) => {
          const l = flagLabel(f);
          return (
            <span key={f} className={l.warn ? "flag warn" : "flag"}>
              {l.text}
            </span>
          );
        })}
      </div>

      <details>
        <summary>Evidence</summary>
        <pre className="evidence">{JSON.stringify(r.evidence, null, 2)}</pre>
      </details>
    </div>
  );
}

export default function Results() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      setReport(await getReport());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!report) return <p>Loading...</p>;

  const s = report.summary;

  return (
    <div>
      <h1>Results</h1>
      <div className="toolbar">
        <button onClick={load}>Refresh</button>
        <button className="secondary" onClick={() => downloadCsv(report)}>
          Export CSV
        </button>
      </div>

      <div className="cards">
        <div className="card">
          <span>Matched</span>
          <strong data-testid="count-matched">{s.matched.count}</strong>
          <small>{money(s.matched.amount)}</small>
        </div>
        <div className="card">
          <span>Partial</span>
          <strong data-testid="count-partial">{s.partial.count}</strong>
          <small>{money(s.partial.amount)}</small>
        </div>
        <div className="card">
          <span>Unmatched</span>
          <strong data-testid="count-unmatched">{s.unmatched.count}</strong>
          <small>{money(s.unmatched.amount)}</small>
        </div>
        <div className="card">
          <span>Invoices still open</span>
          <strong data-testid="count-open">{s.openInvoices.count}</strong>
          <small>{money(s.openInvoices.balance)} due</small>
        </div>
      </div>

      <h2>Matched ({report.matched.length})</h2>
      {report.matched.length === 0 && <p className="muted">Nothing here yet.</p>}
      {report.matched.map((r) => (
        <RowCard key={r.bankTxnId} r={r} />
      ))}

      <h2>Partial ({report.partial.length})</h2>
      {report.partial.length === 0 && <p className="muted">Nothing here yet.</p>}
      {report.partial.map((r) => (
        <RowCard key={r.bankTxnId} r={r} />
      ))}

      <h2>Unmatched ({report.unmatched.length})</h2>
      {report.unmatched.length === 0 && <p className="muted">Nothing here yet.</p>}
      {report.unmatched.map((r) => (
        <RowCard key={r.bankTxnId} r={r} />
      ))}

      <h2>Invoices still open ({report.openInvoices.length})</h2>
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Due date</th>
            <th>Why it is still open</th>
          </tr>
        </thead>
        <tbody>
          {report.openInvoices.map((i) => (
            <tr key={i.invoiceId} data-testid={`open-${i.invoiceId}`}>
              <td>{i.invoiceId}</td>
              <td>{i.customer}</td>
              <td>{money(i.amount)}</td>
              <td>{money(i.paidAmount)}</td>
              <td>{money(i.balance)}</td>
              <td>{shortDate(i.dueDate)}</td>
              <td className="muted">{i.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}