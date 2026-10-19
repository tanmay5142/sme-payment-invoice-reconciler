export type InvoiceLite = {
  id: string;
  amount: number;
  paidAmount: number;
};

export type TxnLite = {
  id: string;
  reference: string | null;
  amount: number;
  status: "CLEARED" | "PENDING";
};

export type Outcome = "MATCHED" | "PARTIAL" | "PENDING" | "UNMATCHED" | "UNCERTAIN";

export type ProposedAllocation = { invoiceId: string; amount: number };

export type RuleFinding = {
  bankTxnId: string;
  outcome: Outcome;
  allocations: ProposedAllocation[];
  reason: string;
  confidence: "HIGH" | "MEDIUM" | "UNCERTAIN";
  flags: string[];
  needsAi: boolean;
  evidence: Record<string, unknown>;
};

// A shortfall up to this many rupees is treated as a likely bank fee.
export const FEE_TOLERANCE = 100;

// Finds invoice numbers like INV-101 in the bank reference.
// "INV106" (no dash) is NOT found on purpose. The AI handles typos later.
export function extractRefs(reference: string | null): string[] {
  if (!reference) return [];
  const found = reference.toUpperCase().match(/\bINV-\d+\b/g) ?? [];
  return [...new Set(found)];
}

function make(
  bankTxnId: string,
  evidence: Record<string, unknown>,
  f: Partial<RuleFinding> & Pick<RuleFinding, "outcome" | "reason" | "confidence">
): RuleFinding {
  return { bankTxnId, allocations: [], flags: [], needsAi: false, evidence, ...f };
}

function checkOne(t: TxnLite, balance: Map<string, number>): RuleFinding {
  const refs = extractRefs(t.reference);
  const evidence: Record<string, unknown> = {
    bankAmount: t.amount,
    bankStatus: t.status,
    reference: t.reference,
    referencesFound: refs,
    invoiceBalances: Object.fromEntries(refs.map((r) => [r, balance.get(r) ?? null])),
  };

  // Rule 1: pending money is not real money yet
  if (t.status === "PENDING") {
    return make(t.id, evidence, {
      outcome: "PENDING",
      confidence: "HIGH",
      flags: ["WAIT_FOR_CLEARANCE"],
      reason:
        "The bank shows this deposit as pending, so the money has not cleared. No invoice is marked paid.",
    });
  }

  // Rule 2: no invoice number found
  if (refs.length === 0) {
    return make(t.id, evidence, {
      outcome: "UNMATCHED",
      confidence: "UNCERTAIN",
      needsAi: true,
      flags: ["NO_REFERENCE"],
      reason: "No clear invoice number (like INV-101) was found in the bank reference.",
    });
  }

  // Rule 3: unknown or already fully paid invoices
  const unknown = refs.filter((r) => !balance.has(r));
  const settled = refs.filter((r) => balance.has(r) && balance.get(r) === 0);
  if (unknown.length > 0 || settled.length > 0) {
    const parts: string[] = [];
    if (unknown.length) parts.push(`${unknown.join(", ")} not found`);
    if (settled.length) parts.push(`${settled.join(", ")} has no balance left`);
    return make(t.id, evidence, {
      outcome: "UNCERTAIN",
      confidence: "UNCERTAIN",
      needsAi: true,
      flags: [
        ...(unknown.length ? ["UNKNOWN_INVOICE"] : []),
        ...(settled.length ? ["ALREADY_PAID"] : []),
      ],
      reason: `The reference points to an invoice we cannot pay: ${parts.join("; ")}.`,
    });
  }

  const total = refs.reduce((sum, r) => sum + (balance.get(r) ?? 0), 0);
  evidence.balanceTotal = total;

  // Rule 4: amount equals the total balance (one invoice or several)
  if (t.amount === total) {
    const allocations = refs.map((r) => ({ invoiceId: r, amount: balance.get(r)! }));
    for (const r of refs) balance.set(r, 0);
    return make(t.id, evidence, {
      outcome: "MATCHED",
      confidence: "HIGH",
      allocations,
      reason:
        refs.length === 1
          ? `Reference ${refs[0]} and amount Rs ${t.amount} both match.`
          : `One payment of Rs ${t.amount} covers ${refs.join(" and ")}. The balances add up exactly, so the money is split between them and counted once.`,
    });
  }

  // Rule 5: one invoice, amount a bit less
  if (refs.length === 1 && t.amount < total) {
    const id = refs[0];
    const short = total - t.amount;
    const likelyFee = short <= FEE_TOLERANCE;
    balance.set(id, total - t.amount);
    return make(t.id, evidence, {
      outcome: "PARTIAL",
      confidence: likelyFee ? "HIGH" : "MEDIUM",
      allocations: [{ invoiceId: id, amount: t.amount }],
      flags: [
        "SHORT_PAID",
        `SHORT_BY_${short}`,
        "NEEDS_ACCOUNTANT",
        ...(likelyFee ? ["LIKELY_BANK_FEE"] : []),
      ],
      reason: likelyFee
        ? `Reference ${id} matches, but the bank received Rs ${t.amount}, which is Rs ${short} less than the balance of Rs ${total}. This looks like a bank fee, so the invoice becomes part-paid and is flagged for the accountant.`
        : `Reference ${id} matches, but the bank received Rs ${t.amount}, which is Rs ${short} less than the balance of Rs ${total}. This is too big to be a bank fee, so the invoice becomes part-paid and is flagged for the accountant.`,
    });
  }

  // Rule 6: everything else
  return make(t.id, evidence, {
    outcome: "UNCERTAIN",
    confidence: "UNCERTAIN",
    needsAi: true,
    flags: [t.amount > total ? "OVERPAID" : "AMOUNT_MISMATCH"],
    reason: `The bank amount Rs ${t.amount} does not fit the referenced invoice(s), whose balance is Rs ${total}.`,
  });
}

// Pure function: no database here, so it is easy to test.
export function runRules(invoices: InvoiceLite[], txns: TxnLite[]): RuleFinding[] {
  const balance = new Map<string, number>();
  for (const inv of invoices) balance.set(inv.id, inv.amount - inv.paidAmount);
  return txns.map((t) => checkOne(t, balance));
}