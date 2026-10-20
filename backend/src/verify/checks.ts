export type VInvoice = {
  id: string;
  amount: number;
  paidAmount: number;
  status: "OPEN" | "PART_PAID" | "PAID";
};
export type VTxn = { id: string; amount: number; status: "CLEARED" | "PENDING" };
export type VAlloc = {
  id: string;
  invoiceId: string;
  bankTxnId: string;
  amount: number;
  status: "PROPOSED" | "APPROVED" | "APPLIED" | "REJECTED";
};

export type CheckStatus = "PASS" | "WARN" | "FAIL";
export type Check = {
  id: string;
  name: string;
  status: CheckStatus;
  detail: string;
  problems: string[];
};
export type TxnRow = {
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
  checks: Check[];
  transactions: TxnRow[];
};

const sum = (nums: number[]) => nums.reduce((s, n) => s + n, 0);

function expectedStatus(paid: number, total: number): "OPEN" | "PART_PAID" | "PAID" {
  if (paid >= total) return "PAID";
  if (paid > 0) return "PART_PAID";
  return "OPEN";
}

function simpleCheck(id: string, name: string, problems: string[], passDetail: string): Check {
  return {
    id,
    name,
    status: problems.length > 0 ? "FAIL" : "PASS",
    detail: problems.length > 0 ? `${problems.length} problem(s) found` : passDetail,
    problems,
  };
}

// Looks only at the observed state (what is really in the database).
export function verifyState(
  invoices: VInvoice[],
  txns: VTxn[],
  allocations: VAlloc[]
): VerifyResult {
  const applied = allocations.filter((a) => a.status === "APPLIED");

  const appliedByTxn = new Map<string, number>();
  const appliedByInvoice = new Map<string, number>();
  for (const a of applied) {
    appliedByTxn.set(a.bankTxnId, (appliedByTxn.get(a.bankTxnId) ?? 0) + a.amount);
    appliedByInvoice.set(a.invoiceId, (appliedByInvoice.get(a.invoiceId) ?? 0) + a.amount);
  }

  const cleared = txns.filter((t) => t.status === "CLEARED");
  const matched = cleared.filter((t) => appliedByTxn.has(t.id));
  const clearedReceipts = sum(cleared.map((t) => t.amount));
  const matchedReceipts = sum(matched.map((t) => t.amount));
  const appliedToInvoices = sum(applied.map((a) => a.amount));
  const pendingInBank = sum(txns.filter((t) => t.status === "PENDING").map((t) => t.amount));
  const notYetMatched = clearedReceipts - matchedReceipts;

  // Check 1: the official check
  const diff = appliedToInvoices - matchedReceipts;
  const moneyCheck: Check = {
    id: "money-equation",
    name: "Matched totals equal cleared bank receipts",
    status: diff === 0 ? "PASS" : diff < 0 ? "WARN" : "FAIL",
    detail: `Applied to invoices: Rs ${appliedToInvoices}. Cleared bank receipts matched: Rs ${matchedReceipts}.`,
    problems:
      diff === 0
        ? []
        : diff < 0
          ? [`Rs ${-diff} of matched bank receipts is not allocated to any invoice yet`]
          : [`Rs ${diff} more was applied to invoices than the cleared bank receipts support`],
  };

  // Check 2: invoice paid amounts match what the agent applied
  const paidProblems: string[] = [];
  for (const inv of invoices) {
    const a = appliedByInvoice.get(inv.id) ?? 0;
    if (inv.paidAmount !== a) {
      paidProblems.push(`${inv.id}: shows Rs ${inv.paidAmount} paid, but the agent applied Rs ${a}`);
    }
  }

  // Check 3: status matches the amount paid
  const statusProblems: string[] = [];
  for (const inv of invoices) {
    if (inv.paidAmount > inv.amount) {
      statusProblems.push(`${inv.id}: paid Rs ${inv.paidAmount} is more than the invoice amount Rs ${inv.amount}`);
    }
    const expected = expectedStatus(inv.paidAmount, inv.amount);
    if (inv.status !== expected) {
      statusProblems.push(`${inv.id}: status is ${inv.status} but it should be ${expected}`);
    }
  }

  // Check 4: nothing applied from deposits that are not cleared
  const txnById = new Map(txns.map((t) => [t.id, t]));
  const pendingProblems = applied
    .filter((a) => txnById.get(a.bankTxnId)?.status !== "CLEARED")
    .map((a) => `${a.bankTxnId}: Rs ${a.amount} applied to ${a.invoiceId} from a deposit that is not cleared`);

  // Check 5: each bank payment is counted once
  const onceProblems: string[] = [];
  for (const t of txns) {
    const a = appliedByTxn.get(t.id) ?? 0;
    if (a > t.amount) {
      onceProblems.push(`${t.id}: Rs ${a} applied, but the bank amount is only Rs ${t.amount}`);
    }
  }

  const checks: Check[] = [
    moneyCheck,
    simpleCheck("invoice-paid-amounts", "Every invoice's paid amount equals what the agent applied", paidProblems, "All invoices agree with the agent's records"),
    simpleCheck("invoice-status", "Invoice status matches the amount paid", statusProblems, "All statuses are correct and nothing is overpaid"),
    simpleCheck("no-pending-money", "No pending deposit was used", pendingProblems, "No money was applied from a pending deposit"),
    simpleCheck("counted-once", "Each bank payment is counted once", onceProblems, "No bank payment was applied more than once"),
  ];

  const transactions = txns.map((t): TxnRow => {
    const a = appliedByTxn.get(t.id) ?? 0;
    const base = { bankTxnId: t.id, bankAmount: t.amount, bankStatus: t.status, appliedTotal: a };
    if (t.status === "PENDING") {
      return a > 0
        ? { ...base, state: "FAILED", note: "Money was applied from a pending deposit" }
        : { ...base, state: "WAITING", note: "Still pending in the bank, so it is not counted" };
    }
    if (a > t.amount) return { ...base, state: "FAILED", note: "More was applied than the bank received" };
    if (a === t.amount) return { ...base, state: "VERIFIED", note: "Fully matched and counted once" };
    if (a === 0) return { ...base, state: "NOT_MATCHED", note: "Cleared, but not matched to any invoice yet" };
    return { ...base, state: "PART_USED", note: `Rs ${a} of Rs ${t.amount} applied, the rest is not allocated` };
  });

  return {
    overall: checks.some((c) => c.status === "FAIL") ? "FAIL" : "PASS",
    totals: { clearedReceipts, matchedReceipts, appliedToInvoices, notYetMatched, pendingInBank },
    checks,
    transactions,
  };
}