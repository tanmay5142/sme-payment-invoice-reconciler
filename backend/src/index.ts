import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { runReconciliation } from "./matching/service";
import { runAi } from "./ai/agent";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/invoices", async (_req, res) => {
  const invoices = await prisma.invoice.findMany({ orderBy: { id: "asc" } });
  res.json(invoices);
});

app.get("/api/bank-transactions", async (_req, res) => {
  const txns = await prisma.bankTransaction.findMany({ orderBy: { id: "asc" } });
  res.json(txns);
});

app.post("/api/invoices/:id/mark-paid", async (req, res) => {
  const id = String(req.params.id);
  const amount = Number(req.body?.amount);

  const invoice = await prisma.invoice.findUnique({ where: { id } });
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (!Number.isInteger(amount) || amount <= 0) {
    res.status(400).json({ error: "Amount must be a whole number above 0" });
    return;
  }

  const remaining = invoice.amount - invoice.paidAmount;
  if (amount > remaining) {
    res.status(400).json({ error: `Amount is more than the balance (${remaining})` });
    return;
  }

  const paidAmount = invoice.paidAmount + amount;
  const status = paidAmount >= invoice.amount ? "PAID" : "PART_PAID";

  const updated = await prisma.invoice.update({
    where: { id },
    data: { paidAmount, status },
  });

  await prisma.auditLog.create({
    data: { action: "MARK_PAID_MANUAL", details: { invoiceId: id, amount, status } },
  });

  res.json(updated);
});

app.post("/api/reconcile/run", async (_req, res) => {
  const result = await runReconciliation();
  res.json(result);
});

app.get("/api/reconcile/results", async (_req, res) => {
  const findings = await prisma.finding.findMany({
    include: { bankTxn: true },
    orderBy: { bankTxnId: "asc" },
  });
  const allocations = await prisma.allocation.findMany({ orderBy: { createdAt: "asc" } });
  res.json({ findings, allocations });
});

app.post("/api/reconcile/ai", async (_req, res) => {
  const result = await runAi();
  res.json(result);
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));