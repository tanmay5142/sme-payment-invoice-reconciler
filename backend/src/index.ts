import "dotenv/config";
import express from "express";
import cors from "cors";
import { prisma } from "./db";

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

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`Backend running on port ${port}`));