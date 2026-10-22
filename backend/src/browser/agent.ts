import fs from "fs";
import path from "path";
import { prisma } from "../db";
import { HttpError } from "../approvals/service";
import { verifyAndLog } from "../verify/service";
import { openBrowser } from "./session";

export const EVIDENCE_DIR = path.join(process.cwd(), "evidence");

const toNumber = (text: string | null) => Number((text ?? "").replace(/[^\d]/g, ""));

// Marks approved payments as paid by using the dashboard in a real browser.
export async function applyWithBrowser(bankTxnId: string) {
  const allocs = await prisma.allocation.findMany({
    where: { bankTxnId, status: "APPROVED" },
    include: { invoice: true },
    orderBy: { invoiceId: "asc" },
  });

  if (allocs.length === 0) {
    const applied = await prisma.allocation.count({ where: { bankTxnId, status: "APPLIED" } });
    if (applied > 0) return { bankTxnId, alreadyApplied: true };
    throw new HttpError(409, "Nothing is approved for this transaction yet");
  }

  const dashboard = (process.env.DASHBOARD_URL ?? "http://localhost:5173").replace(/\/$/, "");
  const steps: { time: string; text: string }[] = [];
  const log = (text: string) => steps.push({ time: new Date().toISOString(), text });

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const session = await openBrowser();

  try {
    const { page } = session;
    page.setDefaultTimeout(15000);
    log(`Opened a ${session.mode} browser`);

    const results = [];
    for (const a of allocs) {
      const id = a.invoiceId;

      await page.goto(`${dashboard}/invoices`);
      await page.waitForSelector(`[data-testid="invoice-row-${id}"]`);
      log(`Opened the Invoices page and found ${id}`);

      // Safety: the dashboard must show what our records say before we change anything
      const paidBefore = toNumber(await page.textContent(`[data-testid="paid-${id}"]`));
      if (paidBefore !== a.invoice.paidAmount) {
        throw new HttpError(
          409,
          `The dashboard shows Rs ${paidBefore} paid for ${id}, but our records say Rs ${a.invoice.paidAmount}. Stopped for safety.`
        );
      }

      await page.click(`#mark-paid-${id}`);
      await page.fill(`#amount-${id}`, String(a.amount));
      await page.fill(`#bank-${id}`, bankTxnId);
      log(`Typed Rs ${a.amount} and bank line ${bankTxnId} for ${id}`);
      await page.click(`#confirm-${id}`);

      // Success: the form closes. Failure: a red error message shows up.
      await page.waitForFunction(
        (rowId: string) => !document.querySelector(`#confirm-${rowId}`) || !!document.querySelector(".error"),
        id
      );
      const errorBox = await page.$(".error");
      if (errorBox) {
        const message = (await errorBox.textContent()) ?? "unknown error";
        throw new HttpError(409, `The dashboard refused the change for ${id}: ${message}`);
      }
      log(`Clicked Confirm for ${id}`);

      // Read the page again to see what really changed
      const expected = a.invoice.paidAmount + a.amount;
      await page.waitForFunction(
        (arg: { rowId: string; expected: number }) => {
          const el = document.querySelector(`[data-testid="paid-${arg.rowId}"]`);
          return !!el && Number((el.textContent ?? "").replace(/[^\d]/g, "")) === arg.expected;
        },
        { rowId: id, expected }
      );

      const paidAfter = toNumber(await page.textContent(`[data-testid="paid-${id}"]`));
      const statusAfter = ((await page.textContent(`[data-testid="status-${id}"]`)) ?? "").trim();
      const bankLine = ((await page.textContent(`[data-testid="bank-${id}"]`)) ?? "").trim();

      const file = `${bankTxnId}-${id}.png`;
      await page.locator(`[data-testid="invoice-row-${id}"]`).screenshot({ path: path.join(EVIDENCE_DIR, file) });
      log(`Read the page: ${id} now shows Rs ${paidAfter} paid, status "${statusAfter}", bank line "${bankLine}"`);

      results.push({ invoiceId: id, paidBefore, paidAfter, statusAfter, bankLine, screenshot: `/evidence/${file}` });
    }

    await prisma.auditLog.create({
      data: {
        action: "BROWSER_APPLIED",
        details: { bankTxnId, mode: session.mode, replayUrl: session.replayUrl, steps, results },
      },
    });

    const verification = await verifyAndLog("after-browser-apply");
    return {
      bankTxnId,
      applied: true,
      mode: session.mode,
      replayUrl: session.replayUrl,
      steps,
      results,
      verification: { overall: verification.overall },
    };
  } catch (e) {
    await prisma.auditLog.create({
      data: { action: "BROWSER_FAILED", details: { bankTxnId, error: (e as Error).message, steps } },
    });
    throw e;
  } finally {
    await session.browser.close();
  }
}