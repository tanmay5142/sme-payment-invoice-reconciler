import { prisma } from "../db";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function statusFor(paid: number, total: number): "OPEN" | "PART_PAID" | "PAID" {
  if (paid >= total) return "PAID";
  if (paid > 0) return "PART_PAID";
  return "OPEN";
}

// All proposals grouped by bank transaction, with a before/after preview
export async function listApprovals() {
  const allocations = await prisma.allocation.findMany({
    include: { invoice: true, bankTxn: { include: { finding: true } } },
    orderBy: [{ bankTxnId: "asc" }, { invoiceId: "asc" }],
  });

  const groups = new Map<
    string,
    { bankTxn: unknown; finding: unknown; status: string; allocations: unknown[] }
  >();

  for (const a of allocations) {
    const applied = a.status === "APPLIED";
    const paidBefore = applied ? a.invoice.paidAmount - a.amount : a.invoice.paidAmount;
    const paidAfter = applied ? a.invoice.paidAmount : a.invoice.paidAmount + a.amount;
    const row = {
      id: a.id,
      invoiceId: a.invoiceId,
      customer: a.invoice.customer,
      amount: a.amount,
      status: a.status,
      invoiceTotal: a.invoice.amount,
      paidBefore,
      paidAfter,
      statusAfter: statusFor(paidAfter, a.invoice.amount),
    };

    const existing = groups.get(a.bankTxnId);
    if (existing) {
      existing.allocations.push(row);
    } else {
      const { finding, ...bankTxn } = a.bankTxn;
      groups.set(a.bankTxnId, { bankTxn, finding, status: a.status, allocations: [row] });
    }
  }
  return [...groups.values()];
}

// Step A: a human approves. The approved version is saved in the audit log.
export async function approveTxn(bankTxnId: string, approvedBy = "demo-user") {
  return prisma.$transaction(
    async (tx) => {
      const txn = await tx.bankTransaction.findUnique({ where: { id: bankTxnId } });
      if (!txn) throw new HttpError(404, "Bank transaction not found");
      if (txn.status !== "CLEARED") {
        throw new HttpError(409, "This deposit is still pending in the bank, so it cannot be approved");
      }

      const allocs = await tx.allocation.findMany({
        where: { bankTxnId, status: "PROPOSED" },
        include: { invoice: true },
      });

      if (allocs.length === 0) {
        const done = await tx.allocation.count({
          where: { bankTxnId, status: { in: ["APPROVED", "APPLIED"] } },
        });
        if (done > 0) return { bankTxnId, alreadyApproved: true };
        throw new HttpError(404, "There is no proposal to approve for this transaction");
      }

      const total = allocs.reduce((s, a) => s + a.amount, 0);
      if (total > txn.amount) {
        throw new HttpError(409, "The proposal is bigger than the bank amount, so it was refused");
      }

      // Stale check: has an invoice changed since the proposal was made?
      const changes = [];
      for (const a of allocs) {
        const remaining = a.invoice.amount - a.invoice.paidAmount;
        if (a.amount > remaining) {
          throw new HttpError(
            409,
            `Invoice ${a.invoiceId} changed (only Rs ${remaining} left). Run the reconciliation again.`
          );
        }
        const paidAfter = a.invoice.paidAmount + a.amount;
        changes.push({
          allocationId: a.id,
          invoiceId: a.invoiceId,
          amount: a.amount,
          paidBefore: a.invoice.paidAmount,
          paidAfter,
          statusAfter: statusFor(paidAfter, a.invoice.amount),
          reason: a.reason,
        });
      }

      // Claim all proposals at once. If someone else got there first, this fails safely.
      const claim = await tx.allocation.updateMany({
        where: { bankTxnId, status: "PROPOSED" },
        data: { status: "APPROVED", approvedAt: new Date() },
      });
      if (claim.count !== allocs.length) {
        throw new HttpError(409, "This proposal was just changed. Refresh and try again.");
      }

      await tx.auditLog.create({
        data: {
          action: "APPROVED",
          details: { bankTxnId, approvedBy, bankAmount: txn.amount, changes },
        },
      });
      return { bankTxnId, approved: true, changes };
    },
    { maxWait: 10000, timeout: 20000 }
  );
}

// Step B: do the action. Safe to call many times.
export async function applyTxn(bankTxnId: string) {
  return prisma.$transaction(
    async (tx) => {
      const allocs = await tx.allocation.findMany({ where: { bankTxnId, status: "APPROVED" } });

      if (allocs.length === 0) {
        const applied = await tx.allocation.count({ where: { bankTxnId, status: "APPLIED" } });
        if (applied > 0) return { bankTxnId, alreadyApplied: true };
        throw new HttpError(409, "Nothing is approved for this transaction yet");
      }

      // Claim first, so a second click or retry cannot apply again
      const claim = await tx.allocation.updateMany({
        where: { bankTxnId, status: "APPROVED" },
        data: { status: "APPLIED", appliedAt: new Date() },
      });
      if (claim.count === 0) return { bankTxnId, alreadyApplied: true };
      if (claim.count !== allocs.length) {
        throw new HttpError(409, "This was just changed by another request. Refresh and try again.");
      }

      const results = [];
      for (const a of allocs) {
        const inv = await tx.invoice.update({
          where: { id: a.invoiceId },
          data: { paidAmount: { increment: a.amount } },
        });
        if (inv.paidAmount > inv.amount) {
          throw new HttpError(409, `Invoice ${inv.id} would be overpaid, so nothing was changed`);
        }
        const status = statusFor(inv.paidAmount, inv.amount);
        await tx.invoice.update({ where: { id: inv.id }, data: { status } });
        results.push({ invoiceId: inv.id, paidAmount: inv.paidAmount, status });
      }

      await tx.auditLog.create({ data: { action: "APPLIED", details: { bankTxnId, results } } });
      return { bankTxnId, applied: true, results };
    },
    { maxWait: 10000, timeout: 20000 }
  );
}

export async function rejectTxn(bankTxnId: string, reason?: string) {
  const res = await prisma.allocation.updateMany({
    where: { bankTxnId, status: "PROPOSED" },
    data: { status: "REJECTED" },
  });
  if (res.count === 0) {
    throw new HttpError(409, "There is no pending proposal to reject for this transaction");
  }
  await prisma.auditLog.create({
    data: { action: "REJECTED", details: { bankTxnId, reason: reason ?? null } },
  });
  return { bankTxnId, rejected: true };
}