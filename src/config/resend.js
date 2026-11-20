import { Resend } from "resend";
import { env } from "./env.js";

let resendClient = null;

export function getResend() {
  if (!env.RESEND_API_KEY) return null;
  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }
  return resendClient;
}

/**
 * Sends a transactional email via Resend with optional Idempotency-Key
 * to prevent duplicate deliveries during background job retries.
 */
export async function sendEmail({ to, subject, html, replyTo, idempotencyKey }) {
  const client = getResend();

  if (!client) {
    console.warn(`[Resend] Skipped email to=${to} subject="${subject}" (RESEND_API_KEY not set)`);
    return { skipped: true };
  }

  const options = idempotencyKey
    ? { headers: { "Idempotency-Key": idempotencyKey } }
    : undefined;

  const { data, error } = await client.emails.send(
    {
      from: env.MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(replyTo ? { replyTo } : {}),
    },
    options
  );

  if (error) {
    throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
  }

  return data;
}