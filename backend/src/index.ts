import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";
import { runReconciliation } from "./matching/service";
import { runAi } from "./ai/agent";
import type { Request, Response, NextFunction } from "express";
import { HttpError, listApprovals, approveTxn, applyTxn, rejectTxn, markInvoicePaid } from "./approvals/service";
import { runVerification, verifyAndLog } from "./verify/service";
import { getReport } from "./results/service";
import { applyWithBrowser, EVIDENCE_DIR } from "./browser/agent";
import { resetDemoData } from "./demo/data";
import { runOfficialTestCases, latestTestRun } from "./testcases/runner";

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

app.get("/api/invoices", wrap(async (_req, res) => {
  const invoices = await prisma.invoice.findMany({
    orderBy: { id: "asc" },
    include: { allocations: { where: { status: "APPLIED" }, select: { bankTxnId: true } } },
  });
  res.json(
    invoices.map(({ allocations, ...inv }) => ({
      ...inv,
      bankLines: [...new Set(allocations.map((a) => a.bankTxnId))],
    }))
  );
}));

app.get("/api/bank-transactions", async (_req, res) => {
  const txns = await prisma.bankTransaction.findMany({ orderBy: { id: "asc" } });
  res.json(txns);
});

app.post("/api/invoices/:id/mark-paid", wrap(async (req, res) => {
  const bankTxnId = req.body?.bankTxnId ? String(req.body.bankTxnId).trim().toUpperCase() : undefined;
  res.json(await markInvoicePaid(String(req.params.id), Number(req.body?.amount), bankTxnId));
}));

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

app.post("/api/approvals/:bankTxnId/apply-browser", wrap(async (req, res) => {
  res.json(await applyWithBrowser(String(req.params.bankTxnId)));
}));

// Screenshots taken by the browser agent
app.use("/evidence", express.static(EVIDENCE_DIR));

app.post("/api/tests/run", wrap(async (req, res) => {
  res.json(await runOfficialTestCases(Boolean(req.body?.useBrowser)));
}));

app.get("/api/tests/latest", wrap(async (_req, res) => {
  res.json(await latestTestRun());
}));

app.post("/api/demo/reset", wrap(async (_req, res) => {
  await resetDemoData();
  res.json({ ok: true });
}));

// Must come after all routes: turns errors into clear messages
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Something went wrong";
  res.status(status).json({ error: message });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));