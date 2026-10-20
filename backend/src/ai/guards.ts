export type Proposal = {
  invoiceId: string;
  amount: number;
  balance: number; // invoice balance at the time of the proposal
  reason: string;
  confidence: string;
};

// Returns an error message if the proposal is not allowed, or null if it is fine.
export function checkProposal(args: {
  invoiceId: string;
  amount: number;
  balance: number | null; // null = invoice does not exist
  txnAmount: number;
  already: Proposal[];
}): string | null {
  if (!Number.isInteger(args.amount) || args.amount <= 0) {
    return "amount must be a whole number above 0";
  }
  if (args.balance === null) return `Invoice ${args.invoiceId} does not exist`;
  if (args.amount > args.balance) {
    return `Invoice ${args.invoiceId} only has Rs ${args.balance} left to pay`;
  }
  if (args.already.some((p) => p.invoiceId === args.invoiceId)) {
    return `Invoice ${args.invoiceId} was already proposed`;
  }
  const used = args.already.reduce((sum, p) => sum + p.amount, 0);
  if (used + args.amount > args.txnAmount) {
    return `The total would be more than the bank amount of Rs ${args.txnAmount}`;
  }
  return null;
}