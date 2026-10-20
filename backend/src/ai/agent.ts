import { Prisma } from "@prisma/client";
import type { BankTransaction, Finding, Outcome } from "@prisma/client";
import { prisma } from "../db";
import { chat } from "./llm";
import type { ChatMessage } from "./llm";
import { checkProposal } from "./guards";
import type { Proposal } from "./guards";

const SYSTEM = `You are an accounting assistant for a small business.
Your job: work out which open invoice(s) one bank transaction is paying for.

Rules:
- Use the tools. Never invent invoice numbers or amounts.
- First use search_invoices (try the customer name from the bank description, and the amount).
- If the customer name and the amount clearly agree with an invoice, call propose_match.
- If you need to pay several invoices, call propose_match for all of them in the same step.
- If the evidence is weak, missing or confusing, call flag_for_human. Do not guess.
- You cannot mark anything as paid. A human approves later.
- All money is in whole rupees.
- Always finish by calling either propose_match or flag_for_human.
- Use the tool-calling feature. Never write JSON in your reply.
- When you call a tool, leave out any field you do not know. Never send null.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: "search_invoices",
      description:
        "Search open invoices (invoices that still have a balance) by customer name and/or balance amount.",
      parameters: {
        type: "object",
        properties: {
          customer_name: { type: "string", description: "Customer name or part of it" },
          amount: { type: "number", description: "Balance amount in rupees" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_match",
      description: "Propose that part or all of this bank payment pays one invoice.",
      parameters: {
        type: "object",
        properties: {
          invoice_id: { type: "string", description: "Invoice number, like INV-106" },
          amount: { type: "number", description: "Rupees of this payment that go to this invoice" },
          reason: { type: "string", description: "One or two plain sentences explaining why" },
        },
        required: ["invoice_id", "amount", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "flag_for_human",
      description: "Use this when you are not sure. A person will check it.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string", description: "Why you could not decide" } },
        required: ["reason"],
      },
    },
  },
];

// Balance that is still free: invoice amount minus paid minus money already proposed or approved
async function availableBalance(invoiceId: string): Promise<number | null> {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) return null;
  const taken = await prisma.allocation.aggregate({
    _sum: { amount: true },
    where: { invoiceId, status: { in: ["PROPOSED", "APPROVED"] } },
  });
  return inv.amount - inv.paidAmount - (taken._sum.amount ?? 0);
}

async function searchInvoices(args: { customer_name?: string; amount?: number }) {
  const invoices = await prisma.invoice.findMany({ orderBy: { id: "asc" } });
  const words = String(args.customer_name ?? "")
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length >= 4);
  const wantedAmount = args.amount == null ? null : Number(args.amount);

  const results = [];
  for (const inv of invoices) {
    const balance = await availableBalance(inv.id);
    if (balance === null || balance <= 0) continue;
    const nameHit = words.some((w) => inv.customer.toLowerCase().includes(w));
    const amountHit = wantedAmount !== null && balance === wantedAmount;
    if (nameHit || amountHit) {
      results.push({
        invoice_id: inv.id,
        customer: inv.customer,
        balance,
        due_date: inv.dueDate.toISOString().slice(0, 10),
        customer_name_matches: nameHit,
        amount_matches: amountHit,
      });
    }
  }
  return results;
}

type Ctx = {
  txnAmount: number;
  proposals: Proposal[];
  flagReason: string | null;
  finalText: string | null;
};

async function runTool(name: string, args: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  if (name === "search_invoices") {
    return searchInvoices({
      customer_name: args.customer_name as string | undefined,
      amount: args.amount as number | undefined,
    });
  }

  if (name === "propose_match") {
    const invoiceId = String(args.invoice_id ?? "").toUpperCase().trim();
    const amount = Number(args.amount);
    const balance = await availableBalance(invoiceId);
    const error = checkProposal({
      invoiceId,
      amount,
      balance,
      txnAmount: ctx.txnAmount,
      already: ctx.proposals,
    });
    if (error) return { error };
    ctx.proposals.push({
      invoiceId,
      amount,
      balance: balance as number,
      reason: String(args.reason ?? ""),
      confidence: "MEDIUM", // AI matches are never shown as HIGH
    });
    return { ok: true, message: "Proposal saved. A human must approve it." };
  }

  if (name === "flag_for_human") {
    ctx.flagReason = String(args.reason ?? "The AI was not sure.");
    return { ok: true, message: "Flagged for a human." };
  }

  return { error: `Unknown tool: ${name}` };
}

type FindingWithTxn = Finding & { bankTxn: BankTransaction };

async function runAgent(f: FindingWithTxn) {
  const t = f.bankTxn;
  const ctx: Ctx = { txnAmount: t.amount, proposals: [], flagReason: null, finalText: null };
  const trace: unknown[] = [];

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: JSON.stringify({
        bank_transaction: {
          id: t.id,
          date: t.date.toISOString().slice(0, 10),
          description: t.description,
          reference: t.reference,
          amount: t.amount,
        },
        what_the_rules_found: f.reason,
      }),
    },
  ];

  for (let step = 0; step < 6; step++) {
    const reply = await chat(messages, TOOLS);
    messages.push({ role: "assistant", content: reply.content ?? null, tool_calls: reply.tool_calls });
    if (!reply.tool_calls?.length) {
      ctx.finalText = reply.content;
      break;
    }

    for (const call of reply.tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        // bad JSON from the model: treat as empty arguments
      }
      const result = await runTool(call.function.name, args, ctx);
      trace.push({ tool: call.function.name, args, result });
      messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }

    // Stop once the agent has made a decision
    if (ctx.proposals.length > 0 || ctx.flagReason) break;
  }

  return { ctx, trace };
}

// Some models write the tool call as plain text JSON. This pulls out the readable reason.
function cleanReason(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]);
      const reason =
        parsed?.arguments?.reason ?? parsed?.parameters?.reason ?? parsed?.reason;
      if (typeof reason === "string") return reason;
    } catch {
      // not valid JSON, use the text as it is
    }
  }
  return text;
}

async function handleOne(f: FindingWithTxn) {
  const t = f.bankTxn;
  if (t.status !== "CLEARED") return { bankTxnId: t.id, skipped: "not cleared" };

  const { ctx, trace } = await runAgent(f);
  const oldEvidence = (f.evidence ?? {}) as Record<string, unknown>;

  let outcome: Outcome;
  let reason: string;
  let confidence: string;
  let flags: string[];

  if (ctx.proposals.length > 0) {
    const sum = ctx.proposals.reduce((s, p) => s + p.amount, 0);
    const allFull = ctx.proposals.every((p) => p.amount === p.balance);
    const matched = allFull && sum === t.amount;
    outcome = matched ? "MATCHED" : "PARTIAL";
    reason = ctx.proposals.map((p) => `${p.invoiceId}: ${p.reason}`).join(" | ");
    confidence = "MEDIUM";
    flags = ["AI_MATCHED", ...(matched ? [] : ["NEEDS_ACCOUNTANT"])];
  } else {
    // No proposal means the AI was unsure, so a human decides
    outcome = f.outcome;
    reason = ctx.flagReason ?? cleanReason(ctx.finalText) ?? "The AI looked through the open invoices and could not find a clear match, so a person should check this.";
    confidence = "UNCERTAIN";
    flags = [...new Set([...f.flags, "AI_FLAGGED"])];
  }

  await prisma.$transaction(
    async (tx) => {
      for (const p of ctx.proposals) {
        await tx.allocation.create({
          data: {
            invoiceId: p.invoiceId,
            bankTxnId: t.id,
            amount: p.amount,
            status: "PROPOSED",
            reason: p.reason,
            confidence: "MEDIUM",
            idempotencyKey: `${t.id}:${p.invoiceId}`,
          },
        });
      }
      await tx.finding.update({
        where: { bankTxnId: t.id },
        data: {
          outcome,
          reason,
          confidence,
          flags,
          needsAi: false,
          source: "AI",
          evidence: { ...oldEvidence, aiTrace: trace } as Prisma.InputJsonObject,
        },
      });
    },
    { timeout: 20000 }
  );

  return { bankTxnId: t.id, outcome, reason, proposals: ctx.proposals, steps: trace.length };
}

export async function runAi() {
  const findings = await prisma.finding.findMany({
    where: { needsAi: true, source: "RULES" },
    include: { bankTxn: true },
    orderBy: { bankTxnId: "asc" },
  });

  const results: unknown[] = [];
  for (const f of findings) {
    try {
      results.push(await handleOne(f));
    } catch (e) {
      // If the AI fails, keep the rules result and flag it. The app keeps working.
      const message = (e as Error).message;
      await prisma.finding.update({
        where: { bankTxnId: f.bankTxnId },
        data: { flags: [...new Set([...f.flags, "AI_FAILED"])] },
      });
      results.push({ bankTxnId: f.bankTxnId, error: message });
    }
  }

  await prisma.auditLog.create({
    data: { action: "AI_RUN", details: { transactionsChecked: findings.length } },
  });
  return { checked: findings.length, results };
}