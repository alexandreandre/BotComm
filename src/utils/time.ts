export function nowMs(): number {
  return Date.now();
}

export function durationSeconds(startMs: number): number {
  return Math.max(0, Math.round((Date.now() - startMs) / 1000));
}

export function withTimeoutDeadline(baseMs: number, maxMs: number): number {
  return Math.min(baseMs, maxMs);
}
