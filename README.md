# SME Payment-to-Invoice Reconciler

An AI agent that helps a small business match bank receipts to open invoices. It finds the matches, a human approves them, the agent marks the invoices paid in a real browser, and a separate step checks that the money adds up.

Built for the **Ziro.Digital Agentic AI Hackathon 2026** by Tanmay Anand (solo builder). GitHub: tanmay5142

- **Live dashboard:** https://sme-payment-invoice-reconciler.vercel.app/invoices
- **Backend health check:** https://sme-payment-invoice-reconciler.vercel.app/invoices/health
- **Demo video:** https://youtu.be/ZEvaBNwCc-M
- **Slides:** https://docs.google.com/presentation/d/1D2ogGBlMg0014ZOuo0LFZt_Wp3IbD80o/edit?usp=drive_link&ouid=115339673809161321214&rtpof=true&sd=true

> The backend runs on a free plan and sleeps when idle. If the dashboard shows errors, open the health link above, wait about a minute, and refresh.

## What the agent does

1. **Collect:** reads the invoice ledger and bank transactions.
2. **Plan:** matches by reference and amount with simple rules. Split payments, short payments and pending deposits are handled by rules. Messy cases (typos, missing references) go to an AI agent.
3. **Find information:** the AI agent searches open invoices with tools and explains every decision.
4. **Take action (human approval required):** a person approves each proposal. Then the agent opens the mock accounting dashboard in a real browser (Playwright locally, Browserbase when deployed), enters the amount and the bank line, and marks the invoice paid.
5. **Verify:** a separate checker reads the real database and confirms that the matched totals equal the cleared bank receipts.
6. **Report:** a matched, partial and unmatched list. Every row links back to its bank record, invoices and evidence.

## How the official test cases are handled

| Test | Scenario | Expected | Result |
|---|---|---|---|
| TC1 | Transfer with matching reference and amount | invoice marked paid with bank line linked | PASS |
| TC2 | One Rs 50,000 transfer covers two invoices | allocated across both, counted once | PASS |
| TC3 | Deposit still pending in bank | invoice not marked paid | PASS |
| TC4 | Receipt Rs 25 short due to bank fee | marked part-paid and flagged for the accountant | PASS |

The **Tests** page of the dashboard runs all four on demand. Each run saves the input, expected result, actual result and evidence, and can be downloaded as a report. If a test ever fails, the page explains what was different instead of hiding it.

## Safety and reliability

- **Rules first, AI second.** Clear cases never touch the AI.
- **The AI can only propose.** It cannot mark anything paid.
- **Every AI proposal is checked by code:** the invoice must exist, the amount cannot be more than the balance, and the total cannot be more than the bank amount. AI matches are always shown as medium confidence.
- **"Uncertain" is allowed.** If evidence is missing, the agent flags the item for a human and does not guess.
- **Human approval** before any invoice changes. The approved version is saved in the audit trail.
- **Retry-safe.** Approving or applying twice does nothing the second time. A stale proposal (the invoice changed after the proposal) is refused. Each action is all-or-nothing.
- **Pending deposits can never be approved.**
- **The dashboard refuses** to link a bank line that was not approved for that exact invoice and amount.
- **Verification runs after every mark-paid** and checks five things: matched totals equal cleared receipts, invoice paid amounts match the agent's records, statuses are correct, no pending money was used, and each bank payment is counted once. Failures stay visible.
- **If the AI is down or rate-limited,** the app keeps working and flags the item for a human.

## Tech stack

- **Backend:** Node.js, TypeScript, Express
- **Database:** PostgreSQL (Neon) with Prisma
- **AI agent:** Groq (free tier) using an OpenAI-style API with tool calling. The provider is set by three environment variables, so it can be swapped.
- **Browser agent:** Playwright (local) and Browserbase (deployed)
- **Frontend:** React, Vite, TypeScript
- **Tests:** Vitest (24 automated tests)
- **Hosting:** Render (backend), Vercel (dashboard), Neon (database)

## Project structure

- `backend/src/matching`: the matching rules and the code that saves findings
- `backend/src/ai`: the AI agent, its tools and the proposal guard
- `backend/src/approvals`: approve, apply, reject and the safe mark-paid action
- `backend/src/browser`: the browser agent (Playwright and Browserbase)
- `backend/src/verify`: the five verification checks
- `backend/src/results`: the matched, partial and unmatched report
- `backend/src/testcases`: the official test case runner
- `backend/src/demo`: the demo data
- `frontend/src/pages`: Invoices, Bank, Reconcile, Results, Verify and Tests pages

## Run it locally

Requirements: Node.js 20 or newer, a free Neon Postgres database, and a free Groq API key.

```bash
git clone https://github.com/tanmay5142/sme-payment-invoice-reconciler.git
cd sme-payment-invoice-reconciler

cd backend
npm install
cp .env.example .env        # then fill in the values
npx prisma migrate deploy
npm run seed
npx playwright install chromium
npm run dev
```

In a second terminal:

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

Open http://localhost:5173. Run the automatic tests with `npm test` inside `backend`.

## Environment variables (backend)

- `DATABASE_URL`: Postgres connection string
- `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`: the AI provider settings
- `BROWSER_MODE`: `local` or `browserbase`
- `DASHBOARD_URL`: the address of the dashboard the browser agent opens
- `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`: only for Browserbase mode

## Honest notes

- Amounts are whole rupees to keep the data simple.
- The browser agent follows fixed steps. The AI decides what to match, the human approves, and the browser does the clicking.
- The demo uses mock data only. No real bank or accounting accounts are connected.