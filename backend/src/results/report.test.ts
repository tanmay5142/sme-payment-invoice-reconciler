import { describe, it, expect } from "vitest";
import { buildReport } from "./report";
import type { RAlloc, RFinding, RInvoice, RTxn } from "./report";

const inv = (id: string, amount: number, paidAmount = 0): RInvoice => ({
  id,
  customer: "Test Customer",
  amount,
  paidAmount,
  dueDate: "2026-10-10",
});
const txn = (id: string, amount: number, reference: string | null, status: RTxn["status"] = "CLEARED"): RTxn => ({
  id,
  date: "2026-10-11",
  description: "test",
  reference,
  amount,
  status,
});
const finding = (bankTxnId: string, referencesFound: string[] = []): RFinding => ({
  bankTxnId,
  reason: "because",
  confidence: "HIGH",
  source: "RULES",
  flags: [],
  evidence: { referencesFound },
});
const alloc = (bankTxnId: string, invoiceId: string, amount: number, status: RAlloc["status"]): RAlloc => ({
  bankTxnId,
  invoiceId,
  amount,
  status,
});

describe("results report", () => {
  it("sorts TC1 to TC4 into matched, partial and unmatched", () => {
    const report = buildReport(
      [inv("INV-101", 12000, 12000), inv("INV-102", 20000, 20000), inv("INV-103", 30000, 30000), inv("INV-104", 8000, 0), inv("INV-105", 15000, 14975)],
      [txn("B-001", 12000, "INV-101"), txn("B-002", 50000, "INV-102 INV-103"), txn("B-003", 8000, "INV-104", "PENDING"), txn("B-004", 14975, "INV-105")],
      [finding("B-001"), finding("B-002"), finding("B-003", ["INV-104"]), finding("B-004")],
      [
        alloc("B-001", "INV-101", 12000, "APPLIED"),
        alloc("B-002", "INV-102", 20000, "APPLIED"),
        alloc("B-002", "INV-103", 30000, "APPLIED"),
        alloc("B-004", "INV-105", 14975, "APPLIED"),
      ]
    );

    expect(report.matched.map((r) => r.bankTxnId)).toEqual(["B-001", "B-002"]);
    expect(report.matched[1].invoices).toHaveLength(2);
    expect(report.partial.map((r) => r.bankTxnId)).toEqual(["B-004"]);
    expect(report.unmatched.map((r) => r.bankTxnId)).toEqual(["B-003"]);
    expect(report.unmatched[0].stage).toBe("PENDING_IN_BANK");
    expect(report.openInvoices.map((i) => i.invoiceId)).toEqual(["INV-104", "INV-105"]);
    expect(report.openInvoices[0].why).toMatch(/B-003/);
    expect(report.openInvoices[1].why).toMatch(/Part paid/);
  });

  it("shows a proposal as waiting for approval", () => {
    const report = buildReport(
      [inv("INV-101", 12000)],
      [txn("B-001", 12000, "INV-101")],
      [finding("B-001")],
      [alloc("B-001", "INV-101", 12000, "PROPOSED")]
    );
    expect(report.matched[0].stage).toBe("AWAITING_APPROVAL");
    expect(report.openInvoices[0].why).toMatch(/waiting for approval/);
  });

  it("shows a rejected proposal as unmatched", () => {
    const report = buildReport(
      [inv("INV-101", 12000)],
      [txn("B-001", 12000, "INV-101")],
      [finding("B-001")],
      [alloc("B-001", "INV-101", 12000, "REJECTED")]
    );
    expect(report.matched).toHaveLength(0);
    expect(report.unmatched[0].stage).toBe("REJECTED");
  });

  it("keeps cleared money with no invoice visible", () => {
    const report = buildReport(
      [inv("INV-107", 9000)],
      [txn("B-006", 3000, null)],
      [finding("B-006")],
      []
    );
    expect(report.unmatched[0].stage).toBe("NOT_MATCHED");
    expect(report.openInvoices[0].why).toBe("No payment found yet");
  });
});