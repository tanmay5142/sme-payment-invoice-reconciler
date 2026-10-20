import { prisma } from "../db";
import { verifyState } from "./checks";

// Reads what is really in the database and checks it
export async function runVerification() {
  const [invoices, txns, allocations] = await Promise.all([
    prisma.invoice.findMany(),
    prisma.bankTransaction.findMany({ orderBy: { id: "asc" } }),
    prisma.allocation.findMany(),
  ]);
  return verifyState(invoices, txns, allocations);
}

// Same check, and it also writes a line in the audit trail
export async function verifyAndLog(trigger: string) {
  const result = await runVerification();
  await prisma.auditLog.create({
    data: {
      action: "VERIFIED",
      details: {
        trigger,
        overall: result.overall,
        totals: result.totals,
        failedChecks: result.checks.filter((c) => c.status === "FAIL").map((c) => c.name),
      },
    },
  });
  return result;
}