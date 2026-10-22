export type TInvoice = { id: string; customer: string; amount: number; paidAmount: number; status: string };
export type TTxn = { id: string; description: string; reference: string | null; amount: number; status: string };
export type TFinding = { bankTxnId: string; outcome: string; reason: string; flags: string[]; source: string };
export type TAlloc = { invoiceId: string; bankTxnId: string; amount: number; status: string };

export type FinalState = {
  invoices: TInvoice[];
  txns: TTxn[];
  findings: TFinding[];
  allocations: TAlloc[];
  // message if the approval was refused, or null if it went through
  approvalErrors: Record<string, string | null>;
  verificationOverall: "PASS" | "FAIL";
};

export type TestCaseDef = {
  id: string;
  scenario: string;
  expected: string;
  invoiceIds: string[];
  txnIds: string[];
};

// The expected results are copied from the official brief.
export const TEST_CASES: TestCaseDef[] = [
  {
    id: "TC1",
    scenario: "Transfer with matching reference and amount",
    expected: "invoice marked paid with bank line linked",
    invoiceIds: ["INV-101"],
    txnIds: ["B-001"],
  },
  {
    id: "TC2",
    scenario: "One Rs 50,000 transfer covers two invoices",
    expected: "allocated across both, counted once",
    invoiceIds: ["INV-102", "INV-103"],
    txnIds: ["B-002"],
  },
  {
    id: "TC3",
    scenario: "Deposit still 'pending' in bank",
    expected: "invoice not marked paid",
    invoiceIds: ["INV-104"],
    txnIds: ["B-003"],
  },
  {
    id: "TC4",
    scenario: "Receipt Rs 25 short due to bank fee",
    expected: "marked part-paid and flagged for the accountant",
    invoiceIds: ["INV-105"],
    txnIds: ["B-004"],
  },
];

const sum = (nums: number[]) => nums.reduce((s, n) => s + n, 0);

// The input of a test: the invoice ledger rows and bank rows it uses
export function describeInput(tc: TestCaseDef, invoices: TInvoice[], txns: TTxn[]) {
  return {
    invoiceLedger: invoices
      .filter((i) => tc.invoiceIds.includes(i.id))
      .map((i) => ({ id: i.id, customer: i.customer, amount: i.amount, paidAmount: i.paidAmount, status: i.status })),
    bankTransactions: txns
      .filter((t) => tc.txnIds.includes(t.id))
      .map((t) => ({ id: t.id, description: t.description, reference: t.reference, amount: t.amount, status: t.status })),
  };
}

export type CaseResult = {
  status: "PASS" | "FAIL";
  actual: string;
  explanation: string;
  evidence: Record<string, unknown>;
};

// Compares what really happened with what the brief expected
export function evaluateCase(tc: TestCaseDef, s: FinalState): CaseResult {
  const txnId = tc.txnIds[0];
  const inv = (id: string) => s.invoices.find((i) => i.id === id);
  const txn = s.txns.find((t) => t.id === txnId);
  const finding = s.findings.find((f) => f.bankTxnId === txnId);
  const applied = s.allocations.filter((a) => a.bankTxnId === txnId && a.status === "APPLIED");
  const appliedTo = (invoiceId: string) =>
    sum(applied.filter((a) => a.invoiceId === invoiceId).map((a) => a.amount));
  const approvalError = s.approvalErrors[txnId] ?? null;

  const missing = [...tc.invoiceIds.filter((id) => !inv(id)), ...(txn ? [] : [txnId])];
  if (missing.length > 0) {
    return {
      status: "FAIL",
      actual: "Test data is missing",
      explanation: `Missing records: ${missing.join(", ")}. Reset the demo data and run again.`,
      evidence: {},
    };
  }

  const problems: string[] = [];
  let actual = "";

  switch (tc.id) {
    case "TC1": {
      const i = inv("INV-101")!;
      if (i.status !== "PAID") {
        problems.push(`Expected INV-101 to be PAID, but it is ${i.status} with Rs ${i.paidAmount} paid.`);
      }
      if (appliedTo("INV-101") !== i.amount) {
        problems.push(`The bank line B-001 is not linked to INV-101 for the full Rs ${i.amount}.`);
      }
      if (approvalError) problems.push(`The approval or mark-paid step failed: ${approvalError}`);
      actual = `INV-101 is ${i.status} (Rs ${i.paidAmount} of Rs ${i.amount} paid). Bank line linked: ${appliedTo("INV-101") > 0 ? "B-001" : "none"}.`;
      break;
    }

    case "TC2": {
      const a = inv("INV-102")!;
      const b = inv("INV-103")!;
      const total = sum(applied.map((x) => x.amount));
      if (a.status !== "PAID") problems.push(`Expected INV-102 to be PAID, but it is ${a.status}.`);
      if (b.status !== "PAID") problems.push(`Expected INV-103 to be PAID, but it is ${b.status}.`);
      if (appliedTo("INV-102") !== a.amount || appliedTo("INV-103") !== b.amount) {
        problems.push("The Rs 50,000 transfer was not split across both invoices as expected.");
      }
      if (total !== txn!.amount) {
        problems.push(`The transfer is Rs ${txn!.amount}, but Rs ${total} was applied from it, so it was not counted once.`);
      }
      const paidAgain = s.allocations.some(
        (x) => x.status === "APPLIED" && x.bankTxnId !== txnId && tc.invoiceIds.includes(x.invoiceId)
      );
      if (paidAgain) problems.push("One of these invoices was also paid from another bank line.");
      if (approvalError) problems.push(`The approval or mark-paid step failed: ${approvalError}`);
      actual = `INV-102 is ${a.status} (Rs ${appliedTo("INV-102")} from B-002). INV-103 is ${b.status} (Rs ${appliedTo("INV-103")} from B-002). Total applied from B-002: Rs ${total} of Rs ${txn!.amount}.`;
      break;
    }

    case "TC3": {
      const i = inv("INV-104")!;
      if (i.status !== "OPEN" || i.paidAmount !== 0) {
        problems.push(`Expected INV-104 to stay OPEN with Rs 0 paid, but it is ${i.status} with Rs ${i.paidAmount} paid.`);
      }
      if (applied.length > 0) problems.push("Money was applied from the pending deposit B-003.");
      if (!approvalError) {
        problems.push("The system should have refused to approve a pending deposit, but it did not.");
      }
      actual = `INV-104 is ${i.status} (Rs ${i.paidAmount} paid). Approval attempt on the pending deposit: ${approvalError ? `refused ("${approvalError}")` : "not refused"}.`;
      break;
    }

    case "TC4": {
      const i = inv("INV-105")!;
      if (i.status !== "PART_PAID") {
        problems.push(`Expected INV-105 to be PART_PAID, but it is ${i.status}.`);
      }
      if (i.paidAmount !== txn!.amount) {
        problems.push(`Expected Rs ${txn!.amount} paid, but found Rs ${i.paidAmount}.`);
      }
      if (!finding?.flags.includes("NEEDS_ACCOUNTANT")) {
        problems.push("The invoice was not flagged for the accountant.");
      }
      if (approvalError) problems.push(`The approval or mark-paid step failed: ${approvalError}`);
      actual = `INV-105 is ${i.status} (Rs ${i.paidAmount} of Rs ${i.amount} paid, Rs ${i.amount - i.paidAmount} still due). Flags: ${finding?.flags.join(", ") ?? "none"}.`;
      break;
    }

    default:
      problems.push(`Unknown test case ${tc.id}.`);
  }

  return {
    status: problems.length === 0 ? "PASS" : "FAIL",
    actual,
    explanation:
      problems.length === 0
        ? `Matches the expected result: ${tc.expected}.`
        : `Does not match the expected result. ${problems.join(" ")}`,
    evidence: {
      invoices: tc.invoiceIds.map((id) => inv(id)),
      bankTransaction: txn,
      decision: finding
        ? { outcome: finding.outcome, reason: finding.reason, flags: finding.flags, source: finding.source }
        : null,
      appliedAllocations: applied,
      approval: approvalError
        ? { refused: true, message: approvalError }
        : { refused: false, approvedBy: "test-runner" },
      verificationAfterRun: s.verificationOverall,
    },
  };
}