export function parseFirstInteger(rawText: string | null): number | null {
  if (!rawText) {
    return null;
  }
  const match = rawText.replace(/,/g, "").match(/\d+/);
  if (!match) {
    return null;
  }
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}
