import { Job } from "../models/Job.js";
import { sendEmail } from "../config/resend.js";

let workerTimer = null;
let isProcessing = false;

function buildEmailFromJob(job) {
  const { type, payload } = job;

  if (type === "SEND_ORDER_CONFIRMATION") {
    const itemsHtml = (payload.items || [])
      .map(
        (i) =>
          `<li>${i.title} (${i.size}) × ${i.quantity} — ₹${Number(i.unitPrice).toLocaleString("en-IN")}</li>`
      )
      .join("");

    return {
      to: payload.email,
      subject: `Order Confirmed — ${payload.orderNumber} | DIVARA`,
      html: `
        <div style="font-family:Georgia,serif;color:#1b1717;max-width:580px;margin:0 auto;padding:24px;">
          <h2 style="letter-spacing:0.15em;text-transform:uppercase;color:#5d100a;">DIVARA</h2>
          <p>Dear ${payload.fullName},</p>
          <p>Thank you for your order <strong>${payload.orderNumber}</strong>. Our atelier has reserved your handwoven piece(s) for dispatch.</p>
          <ul>${itemsHtml}</ul>
          <p><strong>Total Paid: ₹${Number(payload.totalInr).toLocaleString("en-IN")}</strong></p>
          <p style="font-size:12px;color:#5a5353;">Kolkata • Mumbai • New Delhi | support@divara.byfalguni.com</p>
        </div>
      `,
    };
  }

  if (type === "SEND_CONTACT_ACK") {
    return {
      to: payload.email,
      subject: `We Received Your Inquiry (${payload.ticketNumber}) | DIVARA`,
      html: `
        <div style="font-family:Georgia,serif;color:#1b1717;max-width:580px;margin:0 auto;padding:24px;">
          <h2 style="letter-spacing:0.15em;text-transform:uppercase;color:#5d100a;">DIVARA Client Support</h2>
          <p>Dear ${payload.name},</p>
          <p>Thank you for reaching out regarding <strong>"${payload.subject}"</strong>. Your reference number is <strong>${payload.ticketNumber}</strong>.</p>
          <p>A member of our team will respond within 24 hours.</p>
        </div>
      `,
    };
  }

  if (type === "SEND_NEWSLETTER_WELCOME") {
    return {
      to: payload.email,
      subject: "Welcome to DIVARA — Seasonal Lookbooks & Private Releases",
      html: `
        <div style="font-family:Georgia,serif;color:#1b1717;max-width:580px;margin:0 auto;padding:24px;">
          <h2 style="letter-spacing:0.15em;text-transform:uppercase;color:#5d100a;">DIVARA</h2>
          <p>Welcome to our private dispatch list. You will be the first to receive seasonal lookbooks and handwoven release announcements.</p>
        </div>
      `,
    };
  }

  return {
    to: "support@divara.byfalguni.com",
    subject: `[URGENT CONCIERGE] Late Webhook Stock Review — ${payload.orderNumber}`,
    html: `<p>Order <strong>${payload.orderNumber}</strong> (${payload.email}) requires manual concierge stock allocation or refund.</p>`,
  };
}

async function pollNextJob() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const job = await Job.findOneAndUpdate(
      { status: "PENDING", runAt: { $lte: new Date() } },
      { $set: { status: "PROCESSING" }, $inc: { attempts: 1 } },
      { sort: { createdAt: 1 }, returnDocument: "after" }
    );

    if (!job) return;

    try {
      const emailParams = buildEmailFromJob(job);
      await sendEmail({
        ...emailParams,
        idempotencyKey: job.idempotencyKey || String(job._id),
      });

      job.status = "DONE";
      job.completedAt = new Date();
      await job.save();
    } catch (err) {
      job.lastError = err.message;
      if (job.attempts >= job.maxAttempts) {
        job.status = "FAILED";
      } else {
        job.status = "PENDING";
        job.runAt = new Date(Date.now() + job.attempts * 30_000);
      }
      await job.save();
    }
  } catch (pollErr) {
    console.error("[JobWorker] Poll error:", pollErr.message);
  } finally {
    isProcessing = false;
  }
}

export function startJobWorker(intervalMs = 5000) {
  workerTimer = setInterval(pollNextJob, intervalMs);
  return {
    stop: () => workerTimer && clearInterval(workerTimer),
  };
}