function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

export function gradeFib(userInput: string, correct: string): boolean {
  const u = userInput.trim().toLowerCase();
  const c = correct.trim().toLowerCase();
  if (u === c) return true;
  // Fuzzy: accept if Levenshtein ≤ 2 for words ≤ 8 chars, otherwise exact
  if (c.length <= 8) return levenshtein(u, c) <= 2;
  // For longer answers, allow 1 edit per 6 chars (capped at 3)
  const maxDist = Math.min(3, Math.floor(c.length / 6));
  return levenshtein(u, c) <= maxDist;
}

export function gradeMcq(selectedIdx: number, correctIdx: number): boolean {
  return selectedIdx === correctIdx;
}
