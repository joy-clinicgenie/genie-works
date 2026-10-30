import { addDays } from "@clinic-genie/db";

export function sessionSeed(clientId: string): number {
  return [...clientId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

/** Stable daily counts that add up to the recorded period total. Weekends are quieter. */
export function dailySessions(total: number, start: string, days: number, seed: number) {
  const weights = Array.from({ length: days }, (_, index) => {
    const dow = new Date(`${addDays(start, index)}T00:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6 ? 0.46 : 1;
    const wave = 0.82 + 0.22 * Math.sin((index + seed) * 0.62) + 0.08 * Math.sin((index + seed) * 1.4);
    return Math.max(0.2, weekend * wave);
  });
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  const rounded = weights.map((weight) => Math.round((weight / weightSum) * total));
  let drift = total - rounded.reduce((sum, value) => sum + value, 0);
  let step = 0;
  while (drift !== 0 && step < days * 4) {
    const index = (seed + step) % days;
    if (drift > 0) {
      rounded[index] = (rounded[index] ?? 0) + 1;
      drift -= 1;
    } else if ((rounded[index] ?? 0) > 0) {
      rounded[index] = (rounded[index] ?? 0) - 1;
      drift += 1;
    }
    step += 1;
  }
  return rounded;
}
