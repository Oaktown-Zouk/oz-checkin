// Airtable's rate limit is 5 req/sec per base. maxAttempts=3 means up to 3
// retries after the initial attempt (4 tries total) -- matches
// server/src/airtable/realClient.ts's own retry budget, kept in sync by eye
// since the two can't share code (one runs in Node, one in Airtable's
// sandbox).
export function shouldRetryAfterStatus(status: number, attempt: number, maxAttempts = 3): boolean {
  return status === 429 && attempt < maxAttempts;
}

export function retryDelayMs(attempt: number): number {
  return 1000 * (attempt + 1);
}
