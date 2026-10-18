export const money = (n: number) => "₹" + n.toLocaleString("en-IN");

export const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });