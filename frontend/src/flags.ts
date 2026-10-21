import { money } from "./format";

export function flagLabel(flag: string): { text: string; warn: boolean } {
  const short = flag.match(/^SHORT_BY_(\d+)$/);
  if (short) return { text: `Short by ${money(Number(short[1]))}`, warn: true };
  const labels: Record<string, [string, boolean]> = {
    NEEDS_ACCOUNTANT: ["Accountant to review", true],
    SHORT_PAID: ["Short paid", true],
    OVERPAID: ["Overpaid", true],
    LIKELY_BANK_FEE: ["Likely bank fee", false],
    AI_MATCHED: ["Matched by AI", false],
    AI_FLAGGED: ["AI not sure", true],
  };
  const found = labels[flag];
  if (found) return { text: found[0], warn: found[1] };
  return { text: flag.replace(/_/g, " ").toLowerCase(), warn: false };
}