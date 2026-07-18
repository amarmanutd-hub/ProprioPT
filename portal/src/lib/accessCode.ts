/** PROP-8492 style invite codes (prefix + 4 digits). */
const CODE_PREFIX = "PROP-";

function randomDigits(count: number): string {
  const max = 10 ** count;
  const value = crypto.getRandomValues(new Uint32Array(1))[0]! % max;
  return value.toString().padStart(count, "0");
}

export function generateAccessCode(): string {
  return `${CODE_PREFIX}${randomDigits(4)}`;
}

export function normalizeAccessCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (/^\d{4}$/.test(trimmed)) return `${CODE_PREFIX}${trimmed}`;
  return trimmed;
}
