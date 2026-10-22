import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { resetDemoData } from "../demo/data";
import { runReconciliation } from "../matching/service";
import { approveTxn, applyTxn } from "../approvals/service";
import { applyWithBrowser } from "../browser/agent";
import { verifyAndLog } from "../verify/service";
import { TEST_CASES, describeInput, evaluateCase } from "./cases";
import type { FinalState } from "./cases";

export async function runOfficialTestCases(useBrowser: boolean) {
  const batchId = `run-${new Date().toISOString()}`;

  // 1. Start from the same known data every time
  await resetDemoData();

  // 2. Record the input of each test before anything happens
  const startInvoices = await prisma.invoice.findMany();
  const startTxns = await prisma.bankTransaction.findMany();
  const inputs = new Map(TEST_CASES.map((tc) => [tc.id, describeInput(tc, startInvoices, startTxns)]));

  // 3. Matching rules only. The 4 official cases do not need the AI.
  await runReconciliation();

  // 4. Play the human approver, then mark paid
  const approvalErrors: Record<string, string | null> = {};
  for (const tc of TEST_CASES) {
    for (const txnId of tc.txnIds) {
      try {
        await approveTxn(txnId, "test-runner");
        if (useBrowser) await applyWithBrowser(txnId);
        else await applyTxn(txnId);
        approvalErrors[txnId] = null;
      } catch (e) {
        approvalErrors[txnId] = (e as Error).message;
      }
    }
  }

  // 5. Check the work, then compare with what the brief expected
  const verification = await verifyAndLog("test-runner");
  const state: FinalState = {
    invoices: await prisma.invoice.findMany(),
    txns: await prisma.bankTransaction.findMany(),
    findings: await prisma.finding.findMany(),
    allocations: await prisma.allocation.findMany(),
    approvalErrors,
    verificationOverall: verification.overall,
  };

  const rows = TEST_CASES.map((tc) => {
    const result = evaluateCase(tc, state);
    return {
      batchId,
      testCase: tc.id,
      scenario: tc.scenario,
      input: inputs.get(tc.id) as unknown as Prisma.InputJsonObject,
      expected: tc.expected,
      actual: result.actual,
      status: result.status,
      explanation: result.explanation,
      evidence: result.evidence as Prisma.InputJsonObject,
      mode: useBrowser ? "browser" : "api",
    };
  });

  await prisma.testRun.createMany({ data: rows });
  return prisma.testRun.findMany({ where: { batchId }, orderBy: { testCase: "asc" } });
}

export async function latestTestRun() {
  const newest = await prisma.testRun.findFirst({ orderBy: { createdAt: "desc" } });
  if (!newest) return [];
  return prisma.testRun.findMany({ where: { batchId: newest.batchId }, orderBy: { testCase: "asc" } });
}