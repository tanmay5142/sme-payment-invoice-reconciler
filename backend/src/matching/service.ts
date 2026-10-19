import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { runRules } from "./rules";

export async function runReconciliation() {
  const invoices = await prisma.invoice.findMany();
  const allTxns = await prisma.bankTransaction.findMany({
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });

  // Skip transactions a human already approved or that were already applied
  const locked = await prisma.allocation.findMany({
    where: { status: { in: ["APPROVED", "APPLIED"] } },
  });
  const lockedTxnIds = new Set(locked.map((a) => a.bankTxnId));

  // Approved but not yet applied money still counts as taken
  const approvedNotApplied = new Map<string, number>();
  for (const a of locked) {
    if (a.status === "APPROVED") {
      approvedNotApplied.set(a.invoiceId, (approvedNotApplied.get(a.invoiceId) ?? 0) + a.amount);
    }
  }

  const invoiceInput = invoices.map((i) => ({
    id: i.id,
    amount: i.amount,
    paidAmount: i.paidAmount + (approvedNotApplied.get(i.id) ?? 0),
  }));
  const txnInput = allTxns
    .filter((t) => !lockedTxnIds.has(t.id))
    .map((t) => ({ id: t.id, reference: t.reference, amount: t.amount, status: t.status }));

  const findings = runRules(invoiceInput, txnInput);

  await prisma.$transaction(
    async (tx) => {
      // Old proposals that nobody approved are replaced by the new run
      await tx.allocation.deleteMany({ where: { status: { in: ["PROPOSED", "REJECTED"] } } });

      for (const f of findings) {
        const data = {
          outcome: f.outcome,
          reason: f.reason,
          confidence: f.confidence,
          flags: f.flags,
          needsAi: f.needsAi,
          source: "RULES",
          evidence: f.evidence as Prisma.InputJsonObject,
        };
        await tx.finding.upsert({
          where: { bankTxnId: f.bankTxnId },
          create: { bankTxnId: f.bankTxnId, ...data },
          update: data,
        });

        for (const a of f.allocations) {
          await tx.allocation.create({
            data: {
              invoiceId: a.invoiceId,
              bankTxnId: f.bankTxnId,
              amount: a.amount,
              status: "PROPOSED",
              reason: f.reason,
              confidence: f.confidence,
              idempotencyKey: `${f.bankTxnId}:${a.invoiceId}`,
            },
          });
        }
      }

      await tx.auditLog.create({
        data: { action: "RULES_RUN", details: { transactionsChecked: findings.length } },
      });
    },
    { timeout: 20000 }
  );

  const count = (o: string) => findings.filter((f) => f.outcome === o).length;
  return {
    summary: {
      total: findings.length,
      matched: count("MATCHED"),
      partial: count("PARTIAL"),
      pending: count("PENDING"),
      unmatched: count("UNMATCHED"),
      uncertain: count("UNCERTAIN"),
    },
    findings,
  };
}