import { useEffect, useState } from "react";
import { getVerification, runVerification } from "../api";
import type { VerifyResult } from "../api";
import { money } from "../format";

const mark = { PASS: "✓", WARN: "!", FAIL: "✗" };
const stateLabel = {
  VERIFIED: "Verified",
  FAILED: "Failed",
  WAITING: "Waiting (pending)",
  NOT_MATCHED: "Not matched yet",
  PART_USED: "Partly used",
};
const stateClass = {
  VERIFIED: "PAID",
  FAILED: "PENDING",
  WAITING: "PART_PAID",
  NOT_MATCHED: "OPEN",
  PART_USED: "PART_PAID",
};

export default function Verification() {
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getVerification()
      .then(setResult)
      .catch((e) => setError(e.message));
  }, []);

  async function run() {
    setBusy(true);
    setError("");
    try {
      setResult(await runVerification());
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  }

  return (
    <div>
      <h1>Verification</h1>
      <div className="toolbar">
        <button id="run-verification" disabled={busy} onClick={run}>
          {busy ? "Checking..." : "Run verification"}
        </button>
        <span className="muted">
          This also runs by itself after every "mark paid", and each run is saved in the audit trail.
        </span>
      </div>

      {error && <p className="error">{error}</p>}
      {!result && !error && <p>Loading...</p>}

      {result && (
        <>
          <div className={`verdict ${result.overall === "PASS" ? "pass" : "fail"}`} data-testid="verdict">
            {result.overall === "PASS"
              ? "All checks passed. The money adds up."
              : "Some checks failed. See the problems below."}
          </div>

          <div className="cards">
            <div className="card">
              <span>Cleared bank receipts</span>
              <strong data-testid="cleared-receipts">{money(result.totals.clearedReceipts)}</strong>
            </div>
            <div className="card">
              <span>Matched to invoices</span>
              <strong data-testid="matched-receipts">{money(result.totals.matchedReceipts)}</strong>
            </div>
            <div className="card">
              <span>Applied to invoices</span>
              <strong data-testid="applied-total">{money(result.totals.appliedToInvoices)}</strong>
            </div>
            <div className="card">
              <span>Cleared, not matched yet</span>
              <strong>{money(result.totals.notYetMatched)}</strong>
            </div>
            <div className="card">
              <span>Pending in bank (not counted)</span>
              <strong>{money(result.totals.pendingInBank)}</strong>
            </div>
          </div>

          <h2>Checks</h2>
          <ul className="checks">
            {result.checks.map((c) => (
              <li key={c.id} className={c.status} data-testid={`check-${c.id}`}>
                <span className="mark">{mark[c.status]}</span>
                <div>
                  <strong>{c.name}</strong>
                  <div className="muted">{c.detail}</div>
                  {c.problems.length > 0 && (
                    <ul>
                      {c.problems.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <h2>Every bank transaction</h2>
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Bank amount</th>
                <th>Applied to invoices</th>
                <th>Result</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {result.transactions.map((t) => (
                <tr key={t.bankTxnId}>
                  <td>{t.bankTxnId}</td>
                  <td>{money(t.bankAmount)}</td>
                  <td>{money(t.appliedTotal)}</td>
                  <td>
                    <span className={`badge ${stateClass[t.state]}`}>{stateLabel[t.state]}</span>
                  </td>
                  <td className="muted">{t.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}