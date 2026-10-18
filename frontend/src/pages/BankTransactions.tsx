import { useEffect, useState } from "react";
import { getBankTxns } from "../api";
import type { BankTxn } from "../api";
import { money, shortDate } from "../format";

export default function BankTransactions() {
  const [txns, setTxns] = useState<BankTxn[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getBankTxns()
      .then(setTxns)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <h1>Bank transactions</h1>
      {error && <p className="error">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Date</th>
            <th>Description</th>
            <th>Reference</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {txns.map((t) => (
            <tr key={t.id} data-testid={`bank-row-${t.id}`}>
              <td>{t.id}</td>
              <td>{shortDate(t.date)}</td>
              <td>{t.description}</td>
              <td>{t.reference ?? "—"}</td>
              <td>{money(t.amount)}</td>
              <td>
                <span className={`badge ${t.status}`}>
                  {t.status === "CLEARED" ? "Cleared" : "Pending"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}