import { describe, it, expect } from "vitest";
import { verifyState } from "./checks";
import type { VAlloc, VInvoice, VTxn } from "./checks";

const inv = (id: string, amount: number, paidAmount: number, status: VInvoice["status"]): VInvoice => ({
  id, amount, paidAmount, status,
});
const txn = (id: string, amount: number, status: VTxn["status"] = "CLEARED"): VTxn => ({ id, amount, status });
const alloc = (id: string, invoiceId: string, bankTxnId: string, amount: number): VAlloc => ({
  id, invoiceId, bankTxnId, amount, status: "APPLIED",
});

// The end state after TC1 to TC4 were approved and applied
const goodInvoices = () => [
  inv("INV-101", 12000, 12000, "PAID"),
  inv("INV-102", 20000, 20000, "PAID"),
  inv("INV-103", 30000, 30000, "PAID"),
  inv("INV-104", 8000, 0, "OPEN"),
  inv("INV-105", 15000, 14975, "PART_PAID"),
];
const goodTxns = () => [
  txn("B-001", 12000),
  txn("B-002", 50000),
  txn("B-003", 8000, "PENDING"),
  txn("B-004", 14975),
];
const goodAllocs = () => [
  alloc("a1", "INV-101", "B-001", 12000),
  alloc("a2", "INV-102", "B-002", 20000),
  alloc("a3", "INV-103", "B-002", 30000),
  alloc("a4", "INV-105", "B-004", 14975),
];

const find = (r: ReturnType<typeof verifyState>, id: string) => r.checks.find((c) => c.id === id)!;

describe("verification", () => {
  it("passes after TC1 to TC4 are applied correctly", () => {
    const r = verifyState(goodInvoices(), goodTxns(), goodAllocs());
    expect(r.overall).toBe("PASS");
    expect(r.totals.appliedToInvoices).toBe(76975);
    expect(r.totals.matchedReceipts).toBe(76975);
    expect(r.totals.pendingInBank).toBe(8000);
  });

  it("TC3: fails if money is applied from a pending deposit", () => {
    const invoices = goodInvoices();
    invoices[3] = inv("INV-104", 8000, 8000, "PAID");
    const allocs = [...goodAllocs(), alloc("a5", "INV-104", "B-003", 8000)];
    const r = verifyState(invoices, goodTxns(), allocs);
    expect(r.overall).toBe("FAIL");
    expect(find(r, "no-pending-money").status).toBe("FAIL");
  });

  it("fails if an invoice was changed outside the agent", () => {
    const invoices = goodInvoices();
    invoices[0] = inv("INV-101", 12000, 12000, "PAID");
    invoices[3] = inv("INV-104", 8000, 8000, "PAID"); // paid by hand, no agent record
    const r = verifyState(invoices, goodTxns(), goodAllocs());
    expect(r.overall).toBe("FAIL");
    expect(find(r, "invoice-paid-amounts").problems[0]).toMatch(/INV-104/);
  });

  it("TC2: fails if one bank payment is counted more than once", () => {
    const invoices = goodInvoices();
    invoices[3] = inv("INV-104", 8000, 8000, "PAID");
    const allocs = [...goodAllocs(), alloc("a5", "INV-104", "B-002", 8000)]; // B-002 now used for 58000
    const r = verifyState(invoices, goodTxns(), allocs);
    expect(find(r, "counted-once").status).toBe("FAIL");
    expect(r.overall).toBe("FAIL");
  });

  it("only warns when part of a cleared payment is not allocated yet", () => {
    const invoices = [inv("INV-106", 5000, 3000, "PART_PAID")];
    const r = verifyState(invoices, [txn("B-005", 5000)], [alloc("a1", "INV-106", "B-005", 3000)]);
    expect(find(r, "money-equation").status).toBe("WARN");
    expect(r.overall).toBe("PASS");
  });
});