import { useEffect, useState } from "react";
import { getInvoices, markPaid } from "../api";
import type { Invoice } from "../api";
import { money, shortDate } from "../format";

const statusLabel = { OPEN: "Open", PART_PAID: "Part paid", PAID: "Paid" };

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  async function load() {
    try {
      setInvoices(await getInvoices());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function startEdit(inv: Invoice) {
    setEditingId(inv.id);
    setAmount(String(inv.amount - inv.paidAmount));
  }

  async function confirm(id: string) {
    try {
      await markPaid(id, Number(amount));
      setEditingId(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const invoiced = invoices.reduce((s, i) => s + i.amount, 0);
  const received = invoices.reduce((s, i) => s + i.paidAmount, 0);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h1>Invoices</h1>
      {error && <p className="error">{error}</p>}

      <div className="cards">
        <div className="card">
          <span>Total invoiced</span>
          <strong data-testid="total-invoiced">{money(invoiced)}</strong>
        </div>
        <div className="card">
          <span>Received</span>
          <strong data-testid="total-received">{money(received)}</strong>
        </div>
        <div className="card">
          <span>Outstanding</span>
          <strong data-testid="total-outstanding">{money(invoiced - received)}</strong>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Amount</th>
            <th>Paid</th>
            <th>Balance</th>
            <th>Due date</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((inv) => (
            <tr key={inv.id} data-testid={`invoice-row-${inv.id}`}>
              <td>{inv.id}</td>
              <td>{inv.customer}</td>
              <td>{money(inv.amount)}</td>
              <td>{money(inv.paidAmount)}</td>
              <td>{money(inv.amount - inv.paidAmount)}</td>
              <td>{shortDate(inv.dueDate)}</td>
              <td>
                <span className={`badge ${inv.status}`} data-testid={`status-${inv.id}`}>
                  {statusLabel[inv.status]}
                </span>
              </td>
              <td>
                {inv.status === "PAID" ? (
                  "—"
                ) : editingId === inv.id ? (
                  <span className="inline">
                    <input
                      id={`amount-${inv.id}`}
                      type="number"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <button id={`confirm-${inv.id}`} onClick={() => confirm(inv.id)}>
                      Confirm
                    </button>
                    <button className="secondary" onClick={() => setEditingId(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button id={`mark-paid-${inv.id}`} onClick={() => startEdit(inv)}>
                    Mark paid
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}