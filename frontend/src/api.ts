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

export type ApprovalAllocation = {
  id: string;
  invoiceId: string;
  customer: string;
  amount: number;
  status: "PROPOSED" | "APPROVED" | "APPLIED" | "REJECTED";
  invoiceTotal: number;
  paidBefore: number;
  paidAfter: number;
  statusAfter: "OPEN" | "PART_PAID" | "PAID";
};

export type ApprovalGroup = {
  bankTxn: BankTxn;
  finding: {
    outcome: string;
    reason: string;
    confidence: string;
    flags: string[];
    source: string;
  } | null;
  status: "PROPOSED" | "APPROVED" | "APPLIED" | "REJECTED";
  allocations: ApprovalAllocation[];
};

export type AuditLog = { id: string; action: string; details: unknown; createdAt: string };

export const runRules = () => request<unknown>("/api/reconcile/run", { method: "POST" });
export const runAi = () => request<unknown>("/api/reconcile/ai", { method: "POST" });
export const getApprovals = () => request<ApprovalGroup[]>("/api/approvals");
export const approveTxn = (id: string) =>
  request<unknown>(`/api/approvals/${id}/approve`, { method: "POST" });
export const applyTxn = (id: string) =>
  request<unknown>(`/api/approvals/${id}/apply`, { method: "POST" });
export const rejectTxn = (id: string) =>
  request<unknown>(`/api/approvals/${id}/reject`, { method: "POST" });
export const getAuditLogs = () => request<AuditLog[]>("/api/audit-logs");

export type VerifyCheck = {
  id: string;
  name: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
  problems: string[];
};

export type VerifyTxnRow = {
  bankTxnId: string;
  bankAmount: number;
  bankStatus: string;
  appliedTotal: number;
  state: "VERIFIED" | "FAILED" | "WAITING" | "NOT_MATCHED" | "PART_USED";
  note: string;
};

export type VerifyResult = {
  overall: "PASS" | "FAIL";
  totals: {
    clearedReceipts: number;
    matchedReceipts: number;
    appliedToInvoices: number;
    notYetMatched: number;
    pendingInBank: number;
  };
  checks: VerifyCheck[];
  transactions: VerifyTxnRow[];
};

export const getVerification = () => request<VerifyResult>("/api/verification");
export const runVerification = () =>
  request<VerifyResult>("/api/verification", { method: "POST" });

export type ReportRow = {
  bankTxnId: string;
  date: string;
  description: string;
  reference: string | null;
  bankAmount: number;
  bankStatus: "CLEARED" | "PENDING";
  category: "MATCHED" | "PARTIAL" | "UNMATCHED";
  stage: "PAID" | "APPROVED" | "AWAITING_APPROVAL" | "REJECTED" | "NOT_MATCHED" | "PENDING_IN_BANK";
  invoices: { invoiceId: string; customer: string; amount: number; invoiceTotal: number; paidAfter: number }[];
  reason: string;
  confidence: string;
  source: string;
  flags: string[];
  evidence: unknown;
};

export type OpenInvoiceRow = {
  invoiceId: string;
  customer: string;
  amount: number;
  paidAmount: number;
  balance: number;
  dueDate: string;
  why: string;
};

export type Report = {
  summary: {
    matched: { count: number; amount: number };
    partial: { count: number; amount: number };
    unmatched: { count: number; amount: number };
    openInvoices: { count: number; balance: number };
  };
  matched: ReportRow[];
  partial: ReportRow[];
  unmatched: ReportRow[];
  openInvoices: OpenInvoiceRow[];
};

export const getReport = () => request<Report>("/api/report");