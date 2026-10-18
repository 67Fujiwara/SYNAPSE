/** Spaced repetition ladder for shadowing items (shared by Worker and app). */
export const SRS_LADDER = [1, 3, 7, 14, 30];
export const PASS_SCORE = 70;
export const MASTER_SCORE = 90;

/** Next interval in days after an attempt with `score` (0..100). */
export function nextInterval(prevDays: number, score: number): number {
  if (score < PASS_SCORE) return 1;
  const idx = SRS_LADDER.findIndex((d) => d > prevDays);
  return idx === -1 ? SRS_LADDER[SRS_LADDER.length - 1] : SRS_LADDER[idx];
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}
