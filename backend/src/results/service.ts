import { prisma } from "../db";
import { buildReport } from "./report";

export async function getReport() {
  const [invoices, txns, findings, allocations] = await Promise.all([
    prisma.invoice.findMany({ orderBy: { id: "asc" } }),
    prisma.bankTransaction.findMany({ orderBy: { id: "asc" } }),
    prisma.finding.findMany(),
    prisma.allocation.findMany(),
  ]);

  return buildReport(
    invoices.map((i) => ({
      id: i.id,
      customer: i.customer,
      amount: i.amount,
      paidAmount: i.paidAmount,
      dueDate: i.dueDate.toISOString(),
    })),
    txns.map((t) => ({
      id: t.id,
      date: t.date.toISOString(),
      description: t.description,
      reference: t.reference,
      amount: t.amount,
      status: t.status,
    })),
    findings,
    allocations
  );
}