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
 * Sends a transactional email via Resend v4 SDK with proper idempotencyKey option
 * and explicit Render-visible logging on success or failure.
 */
export async function sendEmail({ to, subject, html, replyTo, idempotencyKey }) {
  const client = getResend();

  if (!client) {
    console.warn(`[Resend] Skipped email to=${to} subject="${subject}" (RESEND_API_KEY not set)`);
    return { skipped: true };
  }

  const options = idempotencyKey ? { idempotencyKey: String(idempotencyKey).slice(0, 256) } : undefined;

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
    console.error(`[Resend] Failed to send email from="${env.MAIL_FROM}" to="${to}":`, error);
    throw new Error(`Resend API error: ${error.message || JSON.stringify(error)}`);
  }

  console.log(`[Resend] Sent email id=${data?.id} to="${to}" subject="${subject}"`);
  return data;
}