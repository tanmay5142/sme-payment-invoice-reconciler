import { describe, it, expect } from "vitest";
import { TEST_CASES, evaluateCase } from "./cases";
import type { FinalState } from "./cases";

const good = (): FinalState => ({
  invoices: [
    { id: "INV-101", customer: "A", amount: 12000, paidAmount: 12000, status: "PAID" },
    { id: "INV-102", customer: "B", amount: 20000, paidAmount: 20000, status: "PAID" },
    { id: "INV-103", customer: "B", amount: 30000, paidAmount: 30000, status: "PAID" },
    { id: "INV-104", customer: "C", amount: 8000, paidAmount: 0, status: "OPEN" },
    { id: "INV-105", customer: "D", amount: 15000, paidAmount: 14975, status: "PART_PAID" },
  ],
  txns: [
    { id: "B-001", description: "x", reference: "INV-101", amount: 12000, status: "CLEARED" },
    { id: "B-002", description: "x", reference: "INV-102 INV-103", amount: 50000, status: "CLEARED" },
    { id: "B-003", description: "x", reference: "INV-104", amount: 8000, status: "PENDING" },
    { id: "B-004", description: "x", reference: "INV-105", amount: 14975, status: "CLEARED" },
  ],
  findings: [
    { bankTxnId: "B-001", outcome: "MATCHED", reason: "r", flags: [], source: "RULES" },
    { bankTxnId: "B-002", outcome: "MATCHED", reason: "r", flags: [], source: "RULES" },
    { bankTxnId: "B-003", outcome: "PENDING", reason: "r", flags: ["WAIT_FOR_CLEARANCE"], source: "RULES" },
    { bankTxnId: "B-004", outcome: "PARTIAL", reason: "r", flags: ["SHORT_PAID", "NEEDS_ACCOUNTANT"], source: "RULES" },
  ],
  allocations: [
    { invoiceId: "INV-101", bankTxnId: "B-001", amount: 12000, status: "APPLIED" },
    { invoiceId: "INV-102", bankTxnId: "B-002", amount: 20000, status: "APPLIED" },
    { invoiceId: "INV-103", bankTxnId: "B-002", amount: 30000, status: "APPLIED" },
    { invoiceId: "INV-105", bankTxnId: "B-004", amount: 14975, status: "APPLIED" },
  ],
  approvalErrors: {
    "B-001": null,
    "B-002": null,
    "B-003": "This deposit is still pending in the bank, so it cannot be approved",
    "B-004": null,
  },
  verificationOverall: "PASS",
});

const run = (id: string, s: FinalState) => evaluateCase(TEST_CASES.find((t) => t.id === id)!, s);

describe("official test cases", () => {
  it("all four pass when the system behaves correctly", () => {
    for (const tc of TEST_CASES) {
      expect(evaluateCase(tc, good()).status).toBe("PASS");
    }
  });

  it("TC4 fails with a clear explanation if the invoice was marked fully paid", () => {
    const s = good();
    s.invoices = s.invoices.map((i) => (i.id === "INV-105" ? { ...i, status: "PAID", paidAmount: 15000 } : i));
    const r = run("TC4", s);
    expect(r.status).toBe("FAIL");
    expect(r.explanation).toMatch(/PART_PAID/);
  });

  it("TC3 fails if the pending deposit was not refused", () => {
    const s = good();
    s.approvalErrors["B-003"] = null;
    const r = run("TC3", s);
    expect(r.status).toBe("FAIL");
    expect(r.explanation).toMatch(/refused/);
  });

  it("TC2 fails if an invoice was also paid from another bank line", () => {
    const s = good();
    s.allocations.push({ invoiceId: "INV-102", bankTxnId: "B-009", amount: 5000, status: "APPLIED" });
    const r = run("TC2", s);
    expect(r.status).toBe("FAIL");
    expect(r.explanation).toMatch(/another bank line/);
  });
});