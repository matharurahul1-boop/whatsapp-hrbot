// Normalizes a user-typed WhatsApp number to the country-code-prefixed digit
// string the rest of the app expects (e.g. "9876543210" -> "919876543210").
// Only assumes India (91) when the number is exactly 10 digits — anything
// else (already has a country code, or is malformed) is left untouched so we
// never silently corrupt a valid international number.
export function normalizeWaNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}
