/**
 * Normalizes a phone number to standard WhatsApp format (digits only, starting with country code).
 * For Indonesian numbers, it handles formats starting with 0, 8, +62, and 62.
 */
export function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let cleaned = phone.replace(/\D/g, '');

  // Handle leading '0' for Indonesian numbers
  if (cleaned.startsWith('0')) {
    cleaned = '62' + cleaned.substring(1);
  }

  // If it starts with '8' and has typical length of a mobile number without country code
  if (cleaned.startsWith('8') && cleaned.length >= 9 && cleaned.length <= 11) {
    cleaned = '62' + cleaned;
  }

  return cleaned;
}
