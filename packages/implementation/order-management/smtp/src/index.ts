/**
 * **order-management**, written in **SMTP**: how order-service mails a
 * storefront buyer their receipt and their access links (ADR 0076 §6). The
 * cell is the driver's adapter and nothing else — it imports `nodemailer` and
 * may import nothing that renders, serves or stores (`tech:smtp`, ADR 0060).
 */
export * from './smtp-buyer-notifier';
