import { useEffect, useState } from "react";
import { applyTxn, approveTxn, getApprovals, getAuditLogs, rejectTxn, runAi, runRules } from "../api";
import type { ApprovalGroup, AuditLog } from "../api";
import { money, shortDate } from "../format";
import { flagLabel } from "../flags";

const doneLabel = {
  PROPOSED: "Waiting",
  APPROVED: "Approved, not applied yet",
  APPLIED: "Marked paid",
  REJECTED: "Rejected",
};

export default function Reconcile() {
  const [groups, setGroups] = useState<ApprovalGroup[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    try {
      const [g, l] = await Promise.all([getApprovals(), getAuditLogs()]);
      setGroups(g);
      setLogs(l);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function act(key: string, work: () => Promise<unknown>, doneNote: string) {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await work();
      setNote(doneNote);
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
    setBusy(null);
  }

  const pending = groups.filter((g) => g.status === "PROPOSED");
  const finished = groups.filter((g) => g.status !== "PROPOSED");

  return (
    <div>
      <h1>Reconcile</h1>

      <div className="toolbar">
        <button
          id="run-reconciliation"
          disabled={busy !== null}
          onClick={() =>
            act(
              "run",
              async () => {
                await runRules();
                await runAi();
              },
              "Reconciliation finished. Review the proposals below."
            )
          }
        >
          {busy === "run" ? "Running..." : "Run reconciliation"}
        </button>
        <span className="muted">Nothing is marked paid until you approve it.</span>
      </div>

      {error && <p className="error">{error}</p>}
      {note && <p className="msg">{note}</p>}

      <h2>Needs your approval ({pending.length})</h2>
      {pending.length === 0 && <p className="muted">No proposals waiting. Click "Run reconciliation".</p>}

      {pending.map((g) => (
        <div className="approval" key={g.bankTxn.id} data-testid={`approval-${g.bankTxn.id}`}>
          <div className="approval-head">
            <div>
              <strong>{g.bankTxn.id}</strong> · {g.bankTxn.description}
              <br />
              <small className="muted">
                Reference: {g.bankTxn.reference ?? "none"} · {shortDate(g.bankTxn.date)}
              </small>
            </div>
            <strong>{money(g.bankTxn.amount)}</strong>
          </div>

          {g.finding && <p className="reason">{g.finding.reason}</p>}

          {g.finding && (
            <div className="badges">
              <span className={`badge conf-${g.finding.confidence}`}>{g.finding.confidence} confidence</span>
              {g.finding.flags.map((f) => {
                const l = flagLabel(f);
                return (
                  <span key={f} className={l.warn ? "flag warn" : "flag"}>
                    {l.text}
                  </span>
                );
              })}
            </div>
          )}

          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Apply now</th>
                <th>Paid before → after</th>
                <th>Status after</th>
              </tr>
            </thead>
            <tbody>
              {g.allocations.map((a) => (
                <tr key={a.id}>
                  <td>{a.invoiceId}</td>
                  <td>{a.customer}</td>
                  <td>{money(a.amount)}</td>
                  <td>
                    {money(a.paidBefore)} → {money(a.paidAfter)} of {money(a.invoiceTotal)}
                  </td>
                  <td>
                    <span className={`badge ${a.statusAfter}`}>{a.statusAfter.replace("_", " ")}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="inline actions">
            <button
              id={`approve-${g.bankTxn.id}`}
              disabled={busy !== null}
              onClick={() =>
                act(
                  g.bankTxn.id,
                  async () => {
                    await approveTxn(g.bankTxn.id);
                    await applyTxn(g.bankTxn.id);
                  },
                  `${g.bankTxn.id} approved and invoices marked paid.`
                )
              }
            >
              {busy === g.bankTxn.id ? "Working..." : "Approve and mark paid"}
            </button>
            <button
              id={`reject-${g.bankTxn.id}`}
              className="danger"
              disabled={busy !== null}
              onClick={() => act(g.bankTxn.id, () => rejectTxn(g.bankTxn.id), `${g.bankTxn.id} rejected.`)}
            >
              Reject
            </button>
          </div>
        </div>
      ))}

      <h2>Done ({finished.length})</h2>
      {finished.length === 0 && <p className="muted">Nothing here yet.</p>}
      {finished.map((g) => (
        <div className="approval done" key={g.bankTxn.id}>
          <div className="approval-head">
            <div>
              <strong>{g.bankTxn.id}</strong> · {g.bankTxn.description} · {money(g.bankTxn.amount)}
              <br />
              <small className="muted">{g.allocations.map((a) => `${a.invoiceId} (${money(a.amount)})`).join(", ")}</small>
            </div>
            <span className={`badge ${g.status === "APPLIED" ? "PAID" : g.status === "REJECTED" ? "PENDING" : "PART_PAID"}`}>
              {doneLabel[g.status]}
            </span>
          </div>
          {g.status === "APPROVED" && (
            <button
              id={`apply-${g.bankTxn.id}`}
              disabled={busy !== null}
              onClick={() => act(g.bankTxn.id, () => applyTxn(g.bankTxn.id), `${g.bankTxn.id} marked paid.`)}
            >
              Apply now
            </button>
          )}
        </div>
      ))}

      <h2>Audit trail</h2>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {logs.slice(0, 10).map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleTimeString("en-IN")}</td>
              <td>{l.action}</td>
              <td className="muted">{JSON.stringify(l.details).slice(0, 140)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}