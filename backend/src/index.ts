import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { runReconciliation } from "./matching/service";
import { runAi } from "./ai/agent";
import type { Request, Response, NextFunction } from "express";
import { HttpError, listApprovals, approveTxn, applyTxn, rejectTxn } from "./approvals/service";
import { runVerification, verifyAndLog } from "./verify/service";
import { getReport } from "./results/service";

const app = express();
app.use(cors());
app.use(express.json());

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

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

app.get("/api/approvals", wrap(async (_req, res) => {
  res.json(await listApprovals());
}));

app.post("/api/approvals/:bankTxnId/approve", wrap(async (req, res) => {
  res.json(await approveTxn(String(req.params.bankTxnId)));
}));

app.post("/api/approvals/:bankTxnId/apply", wrap(async (req, res) => {
  const result = await applyTxn(String(req.params.bankTxnId));
  // Check our own work right after acting. Failures are reported, never hidden.
  const verification = await verifyAndLog("after-apply");
  res.json({ ...result, verification: { overall: verification.overall } });
}));

app.post("/api/approvals/:bankTxnId/reject", wrap(async (req, res) => {
  res.json(await rejectTxn(String(req.params.bankTxnId), req.body?.reason));
}));

app.get("/api/audit-logs", wrap(async (_req, res) => {
  res.json(await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }));
}));

app.get("/api/verification", wrap(async (_req, res) => {
  res.json(await runVerification());
}));

app.post("/api/verification", wrap(async (_req, res) => {
  res.json(await verifyAndLog("manual"));
}));

app.get("/api/report", wrap(async (_req, res) => {
  res.json(await getReport());
}));

// Must come after all routes: turns errors into clear messages
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Something went wrong";
  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));