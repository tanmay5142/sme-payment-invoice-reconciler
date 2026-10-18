const API = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export type Invoice = {
  id: string;
  customer: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
  status: "OPEN" | "PART_PAID" | "PAID";
  note: string | null;
};

export type BankTxn = {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  status: "CLEARED" | "PENDING";
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data as T;
}

export const getInvoices = () => request<Invoice[]>("/api/invoices");
export const getBankTxns = () => request<BankTxn[]>("/api/bank-transactions");
export const markPaid = (id: string, amount: number) =>
  request<Invoice>(`/api/invoices/${id}/mark-paid`, {
    method: "POST",
    body: JSON.stringify({ amount }),
  });