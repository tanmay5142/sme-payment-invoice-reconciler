import { describe, it, expect } from "vitest";
import { checkProposal } from "./guards";

const ok = { invoiceId: "INV-106", amount: 5000, balance: 5000, txnAmount: 5000, already: [] };

describe("AI proposal guard", () => {
  it("allows a correct proposal", () => {
    expect(checkProposal(ok)).toBeNull();
  });
  it("rejects an invoice that does not exist", () => {
    expect(checkProposal({ ...ok, balance: null })).toMatch(/does not exist/);
  });
  it("rejects more than the invoice balance", () => {
    expect(checkProposal({ ...ok, amount: 6000, txnAmount: 6000 })).toMatch(/only has/);
  });
  it("rejects more than the bank amount", () => {
    expect(checkProposal({ ...ok, amount: 5000, txnAmount: 4000 })).toMatch(/more than the bank amount/);
  });
  it("rejects proposing the same invoice twice", () => {
    const already = [{ invoiceId: "INV-106", amount: 1000, balance: 5000, reason: "x", confidence: "MEDIUM" }];
    expect(checkProposal({ ...ok, amount: 1000, already })).toMatch(/already proposed/);
  });
});