import { useEffect, useState } from "react";
import { getLatestTests, resetDemo, runTestCases } from "../api";
import type { TestRunRow } from "../api";
import { money } from "../format";

function toMarkdown(rows: TestRunRow[]): string {
  const lines = [
    "# Official test case results",
    "",
    `Run on ${new Date(rows[0].createdAt).toLocaleString("en-IN")}. Mark-paid step used: ${rows[0].mode}.`,
    "",
  ];
  for (const r of rows) {
    lines.push(`## ${r.testCase}: ${r.scenario}`, "", `**Result: ${r.status}**`, "", "**Input**", "", "Invoice ledger:");
    for (const i of r.input.invoiceLedger) {
      lines.push(`- ${i.id} (${i.customer}): Rs ${i.amount}, paid Rs ${i.paidAmount}, ${i.status}`);
    }
    lines.push("", "Bank transactions:");
    for (const t of r.input.bankTransactions) {
      lines.push(`- ${t.id} (${t.description}): Rs ${t.amount}, reference ${t.reference ?? "none"}, ${t.status}`);
    }
    lines.push(
      "",
      `**Expected:** ${r.expected}`,
      "",
      `**Actual:** ${r.actual}`,
      "",
      `**Explanation:** ${r.explanation}`,
      "",
      "**Evidence**",
      "",
      "```json",
      JSON.stringify(r.evidence, null, 2),
      "```",
      ""
    );
  }
  return lines.join("\n");
}

function downloadMarkdown(rows: TestRunRow[]) {
  const url = URL.createObjectURL(new Blob([toMarkdown(rows)], { type: "text/markdown" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = "test-case-results.md";
  a.click();
  URL.revokeObjectURL(url);
}

export default function Tests() {
  const [rows, setRows] = useState<TestRunRow[]>([]);
  const [useBrowser, setUseBrowser] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    getLatestTests()
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);

  async function run() {
    setBusy("run");
    setError("");
    setNote("");
    try {
      setRows(await runTestCases(useBrowser));
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  async function reset() {
    if (!window.confirm("This puts all demo data back to the start. Continue?")) return;
    setBusy("reset");
    setError("");
    try {
      await resetDemo();
      setNote("Demo data was reset. Saved test results are kept.");
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(null);
  }

  const passed = rows.filter((r) => r.status === "PASS").length;

  return (
    <div>
      <h1>Official test cases</h1>

      <div className="toolbar">
        <button id="run-tests" disabled={busy !== null} onClick={run}>
          {busy === "run" ? "Running..." : "Run all 4 official test cases"}
        </button>
        <label className="muted">
          <input type="checkbox" checked={useBrowser} onChange={(e) => setUseBrowser(e.target.checked)} /> Use the
          browser agent to mark invoices paid (slower)
        </label>
        <button className="secondary" disabled={busy !== null} onClick={reset}>
          Reset demo data
        </button>
        {rows.length > 0 && (
          <button className="secondary" onClick={() => downloadMarkdown(rows)}>
            Download report (.md)
          </button>
        )}
      </div>
      <p className="muted">Running the tests resets the demo data first, so every run starts from the same place.</p>

      {error && <p className="error">{error}</p>}
      {note && <p className="msg">{note}</p>}

      {rows.length === 0 && !error && <p className="muted">No test run saved yet. Click the button above.</p>}

      {rows.length > 0 && (
        <div className={`verdict ${passed === rows.length ? "pass" : "fail"}`} data-testid="tests-verdict">
          {passed} of {rows.length} test cases passed
        </div>
      )}

      {rows.map((r) => (
        <div className="approval" key={r.id} data-testid={`test-${r.testCase}`}>
          <div className="approval-head">
            <div>
              <strong>{r.testCase}</strong> · {r.scenario}
            </div>
            <span className={`badge ${r.status === "PASS" ? "PAID" : "PENDING"}`}>{r.status}</span>
          </div>

          <h3>Input</h3>
          <table>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Customer</th>
                <th>Amount</th>
                <th>Paid at start</th>
                <th>Status at start</th>
              </tr>
            </thead>
            <tbody>
              {r.input.invoiceLedger.map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td>{i.customer}</td>
                  <td>{money(i.amount)}</td>
                  <td>{money(i.paidAmount)}</td>
                  <td>{i.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Bank ID</th>
                <th>Description</th>
                <th>Reference</th>
                <th>Amount</th>
                <th>Bank status</th>
              </tr>
            </thead>
            <tbody>
              {r.input.bankTransactions.map((t) => (
                <tr key={t.id}>
                  <td>{t.id}</td>
                  <td>{t.description}</td>
                  <td>{t.reference ?? "none"}</td>
                  <td>{money(t.amount)}</td>
                  <td>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p>
            <strong>Expected:</strong> {r.expected}
          </p>
          <p>
            <strong>Actual:</strong> {r.actual}
          </p>
          <p className="reason">{r.explanation}</p>

          <details>
            <summary>Evidence</summary>
            <pre className="evidence">{JSON.stringify(r.evidence, null, 2)}</pre>
          </details>
        </div>
      ))}
    </div>
  );
}