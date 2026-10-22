import { prisma } from "../db";

// Puts the database back to the known demo data. Test results are kept.
export async function resetDemoData() {
  await prisma.finding.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.allocation.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.bankTransaction.deleteMany();

  await prisma.invoice.createMany({
    data: [
      // TC1: matching reference and amount
      { id: "INV-101", customer: "Sharma Traders", amount: 12000, dueDate: new Date("2026-10-05") },
      // TC2: one transfer covers both
      { id: "INV-102", customer: "Patel Hardware", amount: 20000, dueDate: new Date("2026-10-06") },
      { id: "INV-103", customer: "Patel Hardware", amount: 30000, dueDate: new Date("2026-10-06") },
      // TC3: deposit still pending
      { id: "INV-104", customer: "Gupta Stores", amount: 8000, dueDate: new Date("2026-10-08") },
      // TC4: Rs 25 short
      { id: "INV-105", customer: "Rao Enterprises", amount: 15000, dueDate: new Date("2026-10-09") },
      // Extra: reference has a typo
      { id: "INV-106", customer: "Mehta Foods", amount: 5000, dueDate: new Date("2026-10-10") },
      // Extra: nobody has paid this
      { id: "INV-107", customer: "Iyer Textiles", amount: 9000, dueDate: new Date("2026-10-12") },
    ],
  });

  await prisma.bankTransaction.createMany({
    data: [
      // TC1
      { id: "B-001", date: new Date("2026-10-07"), description: "NEFT Sharma Traders", reference: "INV-101", amount: 12000, status: "CLEARED" },
      // TC2
      { id: "B-002", date: new Date("2026-10-08"), description: "NEFT Patel Hardware", reference: "INV-102 INV-103", amount: 50000, status: "CLEARED" },
      // TC3
      { id: "B-003", date: new Date("2026-10-10"), description: "NEFT Gupta Stores", reference: "INV-104", amount: 8000, status: "PENDING" },
      // TC4 (15000 minus Rs 25 bank fee)
      { id: "B-004", date: new Date("2026-10-11"), description: "IMPS Rao Enterprises", reference: "INV-105", amount: 14975, status: "CLEARED" },
      // Extra: typo in reference
      { id: "B-005", date: new Date("2026-10-12"), description: "UPI Mehta Foods", reference: "INV106", amount: 5000, status: "CLEARED" },
      // Extra: matches nothing
      { id: "B-006", date: new Date("2026-10-13"), description: "NEFT Unknown Sender", reference: null, amount: 3000, status: "CLEARED" },
    ],
  });
}