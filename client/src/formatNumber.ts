// Compact number formatting for tight UI slots (dice faces, chips) where a
// full number like 50500 would overflow the silhouette. Keeps one decimal
// with a comma separator, Russian-style suffixes: 50500 -> "50,5к".
export function formatCompactNumber(value: number): string {
  const abs = Math.abs(value);
  if (abs < 10_000) return String(Math.round(value));
  const [divisor, suffix] = abs < 1_000_000 ? [1_000, "к"] : [1_000_000, "м"];
  const scaled = value / divisor;
  // Drop the ",0" tail, and skip the decimal entirely once the integer part
  // is three digits wide (999к rather than 999,4к).
  const digits = Math.abs(scaled) >= 100 ? 0 : 1;
  const text = scaled.toFixed(digits).replace(/\.0$/, "").replace(".", ",");
  return text + suffix;
}
