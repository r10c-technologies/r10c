import { normalizePhone } from './buyer-contact';

/**
 * A click-to-chat link that opens WhatsApp on `phone` with `text` already
 * typed — `wa.me`, no API and no account on our side (#671). `undefined` when
 * the phone is not one we can dial, so a stored value that went wrong offers
 * no link rather than a broken one.
 */
export const whatsappChatUrl = (
  phone: string | undefined,
  text: string,
): string | undefined => {
  const e164 = normalizePhone(phone);
  if (e164 === undefined) return undefined;
  return `https://wa.me/${e164.slice(1)}?text=${encodeURIComponent(text)}`;
};
