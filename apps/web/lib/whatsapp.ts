/**
 * "Message via WhatsApp" (REQ-NOTIF-002): a wa.me link that opens a chat with prefilled text.
 * The number is E.164; wa.me wants the digits only. Nothing is sent by the app: the staff member
 * reads the message in WhatsApp and sends it themselves.
 */
export function whatsAppLink(phoneE164: string, text: string): string | null {
  const digits = phoneE164.replace(/\D/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(phoneE164) || digits.length < 8) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
