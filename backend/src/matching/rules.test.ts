import { describe, it, expect } from "vitest";
import { runRules } from "./rules";

const inv = (id: string, amount: number, paidAmount = 0) => ({ id, amount, paidAmount });
const txn = (
  id: string,
  reference: string | null,
  amount: number,
  status: "CLEARED" | "PENDING" = "CLEARED"
) => ({ id, reference, amount, status });

describe("official test cases", () => {
  it("TC1: matching reference and amount is matched and linked", () => {
    const [f] = runRules([inv("INV-101", 12000)], [txn("B-001", "INV-101", 12000)]);
    expect(f.outcome).toBe("MATCHED");
    expect(f.allocations).toEqual([{ invoiceId: "INV-101", amount: 12000 }]);
  });

  it("TC2: one Rs 50,000 transfer covers two invoices, counted once", () => {
    const [f] = runRules(
      [inv("INV-102", 20000), inv("INV-103", 30000)],
      [txn("B-002", "INV-102 INV-103", 50000)]
    );
    expect(f.outcome).toBe("MATCHED");
    expect(f.allocations).toHaveLength(2);
    const total = f.allocations.reduce((s, a) => s + a.amount, 0);
    expect(total).toBe(50000);
  });

  it("TC3: pending deposit does not pay the invoice", () => {
    const [f] = runRules([inv("INV-104", 8000)], [txn("B-003", "INV-104", 8000, "PENDING")]);
    expect(f.outcome).toBe("PENDING");
    expect(f.allocations).toEqual([]);
  });

  it("TC4: Rs 25 short is part-paid and flagged for the accountant", () => {
    const [f] = runRules([inv("INV-105", 15000)], [txn("B-004", "INV-105", 14975)]);
    expect(f.outcome).toBe("PARTIAL");
    expect(f.allocations).toEqual([{ invoiceId: "INV-105", amount: 14975 }]);
    expect(f.flags).toContain("NEEDS_ACCOUNTANT");
    expect(f.flags).toContain("LIKELY_BANK_FEE");
  });
});

describe("extra cases", () => {
  it("a typo in the reference is left for the AI", () => {
    const [f] = runRules([inv("INV-106", 5000)], [txn("B-005", "INV106", 5000)]);
    expect(f.outcome).toBe("UNMATCHED");
    expect(f.needsAi).toBe(true);
  });

  it("the same invoice cannot be paid twice in one run", () => {
    const result = runRules(
      [inv("INV-101", 12000)],
      [txn("B-001", "INV-101", 12000), txn("B-009", "INV-101", 12000)]
    );
    expect(result[0].outcome).toBe("MATCHED");
    expect(result[1].outcome).toBe("UNCERTAIN");
    expect(result[1].allocations).toEqual([]);
  });
});