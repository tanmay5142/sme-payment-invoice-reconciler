export type RInvoice = {
  id: string;
  customer: string;
  amount: number;
  paidAmount: number;
  dueDate: string;
};
export type RTxn = {
  id: string;
  date: string;
  description: string;
  reference: string | null;
  amount: number;
  status: "CLEARED" | "PENDING";
};
export type RFinding = {
  bankTxnId: string;
  reason: string;
  confidence: string;
  source: string;
  flags: string[];
  evidence: unknown;
};
export type RAlloc = {
  invoiceId: string;
  bankTxnId: string;
  amount: number;
  status: "PROPOSED" | "APPROVED" | "APPLIED" | "REJECTED";
};

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

const sum = (nums: number[]) => nums.reduce((s, n) => s + n, 0);

function referencesOf(f: RFinding | undefined): string[] {
  const ev = f?.evidence as { referencesFound?: unknown } | null | undefined;
  const refs = ev?.referencesFound;
  return Array.isArray(refs) ? refs.filter((r): r is string => typeof r === "string") : [];
}

export function buildReport(
  invoices: RInvoice[],
  txns: RTxn[],
  findings: RFinding[],
  allocations: RAlloc[]
): Report {
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const findingByTxn = new Map(findings.map((f) => [f.bankTxnId, f]));

  const matched: ReportRow[] = [];
  const partial: ReportRow[] = [];
  const unmatched: ReportRow[] = [];

  for (const t of txns) {
    const f = findingByTxn.get(t.id);
    const mine = allocations.filter((a) => a.bankTxnId === t.id);
    const active = mine.filter((a) => a.status !== "REJECTED");

    const base = {
      bankTxnId: t.id,
      date: t.date,
      description: t.description,
      reference: t.reference,
      bankAmount: t.amount,
      bankStatus: t.status,
      reason: f?.reason ?? "No result yet. Run the reconciliation.",
      confidence: f?.confidence ?? "UNCERTAIN",
      source: f?.source ?? "NONE",
      flags: f?.flags ?? [],
      evidence: f?.evidence ?? null,
    };

    // Money still pending in the bank is never matched
    if (t.status === "PENDING") {
      unmatched.push({ ...base, category: "UNMATCHED", stage: "PENDING_IN_BANK", invoices: [] });
      continue;
    }

    // Cleared money with no active proposal
    if (active.length === 0) {
      unmatched.push({
        ...base,
        category: "UNMATCHED",
        stage: mine.length > 0 ? "REJECTED" : "NOT_MATCHED",
        invoices: [],
      });
      continue;
    }

    const rows = active.map((a) => {
      const inv = invoiceById.get(a.invoiceId);
      const paid = inv?.paidAmount ?? 0;
      return {
        invoiceId: a.invoiceId,
        customer: inv?.customer ?? "Unknown",
        amount: a.amount,
        invoiceTotal: inv?.amount ?? 0,
        // applied money is already inside paidAmount
        paidAfter: a.status === "APPLIED" ? paid : paid + a.amount,
      };
    });

    const allocated = sum(active.map((a) => a.amount));
    const complete = rows.every((r) => r.paidAfter >= r.invoiceTotal) && allocated === t.amount;
    const stage = active.some((a) => a.status === "APPLIED")
      ? "PAID"
      : active.some((a) => a.status === "APPROVED")
        ? "APPROVED"
        : "AWAITING_APPROVAL";

    (complete ? matched : partial).push({
      ...base,
      category: complete ? "MATCHED" : "PARTIAL",
      stage,
      invoices: rows,
    });
  }

  // Invoices that still have a balance, and why
  const openInvoices: OpenInvoiceRow[] = [];
  for (const inv of invoices) {
    const balance = inv.amount - inv.paidAmount;
    if (balance <= 0) continue;

    const proposal = allocations.find(
      (a) => a.invoiceId === inv.id && (a.status === "PROPOSED" || a.status === "APPROVED")
    );
    const waitingOn = txns
      .filter((t) => t.status === "PENDING" && referencesOf(findingByTxn.get(t.id)).includes(inv.id))
      .map((t) => t.id);

    let why = "No payment found yet";
    if (proposal) why = `Payment ${proposal.bankTxnId} proposed, waiting for approval`;
    else if (waitingOn.length > 0) why = `Waiting for deposit ${waitingOn.join(", ")} to clear in the bank`;
    else if (inv.paidAmount > 0) why = `Part paid, Rs ${balance} still due. Accountant to review.`;

    openInvoices.push({
      invoiceId: inv.id,
      customer: inv.customer,
      amount: inv.amount,
      paidAmount: inv.paidAmount,
      balance,
      dueDate: inv.dueDate,
      why,
    });
  }

  const total = (rows: ReportRow[]) => ({ count: rows.length, amount: sum(rows.map((r) => r.bankAmount)) });

  return {
    summary: {
      matched: total(matched),
      partial: total(partial),
      unmatched: total(unmatched),
      openInvoices: { count: openInvoices.length, balance: sum(openInvoices.map((i) => i.balance)) },
    },
    matched,
    partial,
    unmatched,
    openInvoices,
  };
}