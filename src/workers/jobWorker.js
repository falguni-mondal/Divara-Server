import { Job } from "../models/Job.js";
import { sendEmail } from "../config/resend.js";
import { env } from "../config/env.js";

let workerTimer = null;
let isProcessing = false;

const SITE_URL = env.CLIENT_ORIGIN.replace(/\/$/, "");
const ADMIN_EMAIL = env.ADMIN_NOTIFICATION_EMAIL;
const MAX_JOBS_PER_TICK = 10;
const STALE_LOCK_MS = 5 * 60 * 1000;
const SEND_THROTTLE_MS = 650;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(val) {
  return String(val ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatIST(dateValue) {
  return (
    new Date(dateValue || Date.now()).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }) + " IST"
  );
}

function formatINR(amount) {
  return `₹${Number(amount || 0).toLocaleString("en-IN")}`;
}

function renderEmailShell({ eyebrow, title, bodyHtml, buttons = [] }) {
  const buttonRow =
    buttons.length > 0
      ? `<div style="margin:28px 0 8px;">${buttons
          .map((btn, idx) => {
            const bg = idx === 0 ? "#5d100a" : "#1b1717";
            return `<a href="${escapeHtml(btn.href)}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 24px;background:${bg};color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;border-radius:2px;">${escapeHtml(btn.label)}</a>`;
          })
          .join("")}</div>`
      : "";

  return `
    <div style="background:#f8f6f4;padding:32px 16px;font-family:Georgia,serif;color:#1b1717;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e6e2de;padding:36px 32px;">
        <div style="border-bottom:2px solid #5d100a;padding-bottom:16px;margin-bottom:24px;">
          <div style="font-size:22px;letter-spacing:0.28em;color:#1b1717;font-weight:400;">DIVARA</div>
          <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5d100a;margin-top:6px;">${escapeHtml(eyebrow)}</div>
        </div>
        <h2 style="font-size:22px;font-weight:400;margin:0 0 16px;color:#1b1717;">${escapeHtml(title)}</h2>
        <div style="font-family:Arial,sans-serif;font-size:13.5px;line-height:1.7;color:#332d2d;">
          ${bodyHtml}
        </div>
        ${buttonRow}
        <div style="margin-top:32px;padding-top:18px;border-top:1px solid #e6e2de;font-family:Arial,sans-serif;font-size:11px;color:#756d6d;">
          DIVARA Atelier • Kolkata • Mumbai • New Delhi<br/>
          <a href="${escapeHtml(SITE_URL)}" style="color:#5d100a;text-decoration:none;">divara.byfalguni.com</a> &nbsp;|&nbsp; support@divara.byfalguni.com
        </div>
      </div>
    </div>
  `;
}

function renderItemsTable(items = []) {
  const rows = items
    .map(
      (i) => `
      <tr>
        <td style="padding:8px 0;border-bottom:1px solid #eee;"><strong>${escapeHtml(i.title)}</strong><br/><span style="font-size:11px;color:#666;">Size: ${escapeHtml(i.size)} • SKU: ${escapeHtml(i.sku || "N/A")}</span></td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">× ${Number(i.quantity || 1)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatINR((i.unitPrice || 0) * (i.quantity || 1))}</td>
      </tr>`
    )
    .join("");

  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12.5px;">${rows}</table>`;
}

function buildEmailFromJob(job) {
  const { type, payload = {} } = job;

  if (type === "SEND_WELCOME_EMAIL") {
    return {
      to: payload.email,
      subject: "Welcome to DIVARA — Your Atelier Account Is Ready",
      html: renderEmailShell({
        eyebrow: "Private Client Welcome",
        title: `Welcome to DIVARA, ${payload.fullName || "Guest"}`,
        bodyHtml: `<p>Your DIVARA account is now active. You can save garments to your shopping bag, apply member offers, track insured deliveries, and share reviews across our seasonal collections.</p>`,
        buttons: [
          { label: "Explore Collection", href: `${SITE_URL}/collections` },
          { label: "My Account", href: `${SITE_URL}/account` },
        ],
      }),
    };
  }

  if (type === "SEND_ORDER_CONFIRMATION") {
    const addr = payload.shippingAddress || {};
    const addressLine = [
      addr.fullName || payload.fullName,
      addr.line1,
      addr.line2,
      addr.city,
      addr.state,
      addr.postalCode,
    ]
      .filter(Boolean)
      .map(escapeHtml)
      .join(", ");

    return {
      to: payload.email,
      subject: `Order Confirmed — ${payload.orderNumber} | DIVARA`,
      html: renderEmailShell({
        eyebrow: "Order Confirmation",
        title: `Thank You for Your Order, ${payload.fullName || "Valued Client"}`,
        bodyHtml: `
          <p>We have received your payment and reserved your handwoven piece(s) at our atelier.</p>
          <p><strong>Order Number:</strong> ${escapeHtml(payload.orderNumber)}<br/>
          <strong>Placed On:</strong> ${escapeHtml(formatIST(payload.paidAt))}</p>
          ${renderItemsTable(payload.items)}
          <p style="margin-top:12px;">
            MRP Subtotal (Incl. GST): ${formatINR(payload.subtotalInr)}<br/>
            ${payload.discountInr > 0 ? `Discount (${escapeHtml(payload.couponCode)}): -${formatINR(payload.discountInr)}<br/>` : ""}
            Included GST (12%): ${formatINR(payload.gstInr)}<br/>
            <strong>Total Paid: ${formatINR(payload.totalInr)}</strong>
          </p>
          <p><strong>Shipping To:</strong><br/>
          ${addressLine} (${escapeHtml(addr.phone || "")})</p>
        `,
        buttons: [
          { label: "View Order Status", href: `${SITE_URL}/account` },
          { label: "Continue Shopping", href: `${SITE_URL}/collections` },
        ],
      }),
    };
  }

  if (type === "SEND_ADMIN_ORDER_SUCCESS") {
    const addr = payload.shippingAddress || {};
    return {
      to: ADMIN_EMAIL,
      subject: `[NEW PAID ORDER] ${payload.orderNumber} — ${formatINR(payload.totalInr)} | DIVARA`,
      html: renderEmailShell({
        eyebrow: "Admin Order Alert • Paid",
        title: `New Paid Order: ${payload.orderNumber}`,
        bodyHtml: `
          <p><strong>Date &amp; Time:</strong> ${escapeHtml(formatIST(payload.paidAt))}<br/>
          <strong>Customer:</strong> ${escapeHtml(addr.fullName || payload.fullName)}<br/>
          <strong>Email:</strong> ${escapeHtml(payload.email)} &nbsp;|&nbsp; <strong>Phone:</strong> ${escapeHtml(addr.phone || "N/A")}<br/>
          <strong>Address:</strong> ${escapeHtml([addr.line1, addr.line2, addr.city, addr.state, addr.postalCode].filter(Boolean).join(", "))}<br/>
          <strong>Razorpay Order:</strong> ${escapeHtml(payload.razorpayOrderId || "N/A")}<br/>
          <strong>Razorpay Payment:</strong> ${escapeHtml(payload.razorpayPaymentId || "N/A")}</p>
          ${renderItemsTable(payload.items)}
          <p><strong>MRP Subtotal:</strong> ${formatINR(payload.subtotalInr)} &nbsp;|&nbsp;
          ${payload.discountInr > 0 ? `<strong>Coupon (${escapeHtml(payload.couponCode)}):</strong> -${formatINR(payload.discountInr)} &nbsp;|&nbsp;` : ""}
          <strong>Included GST:</strong> ${formatINR(payload.gstInr)} &nbsp;|&nbsp;
          <strong>Total Paid:</strong> ${formatINR(payload.totalInr)}</p>
        `,
        buttons: [
          { label: "Open Admin Orders", href: `${SITE_URL}/account?tab=orders` },
          { label: "Email Customer", href: `mailto:${encodeURIComponent(payload.email || "")}?subject=${encodeURIComponent(`Your DIVARA Order ${payload.orderNumber || ""}`)}` },
        ],
      }),
    };
  }

  if (type === "SEND_ADMIN_ORDER_FAILURE") {
    const addr = payload.shippingAddress || {};
    return {
      to: ADMIN_EMAIL,
      subject: `[ORDER / PAYMENT FAILED] ${payload.orderNumber} — ${formatINR(payload.totalInr)} | DIVARA`,
      html: renderEmailShell({
        eyebrow: "Admin Recovery Alert • Payment Failed",
        title: `Payment Failed for Order ${payload.orderNumber}`,
        bodyHtml: `
          <p style="color:#5d100a;font-weight:600;">Failure Reason: ${escapeHtml(payload.failureReason || "Payment declined or checkout hold expired")}</p>
          <p><strong>Date &amp; Time:</strong> ${escapeHtml(formatIST(payload.failedAt))}<br/>
          <strong>Error Code / Method:</strong> ${escapeHtml(payload.errorCode || "N/A")} / ${escapeHtml(payload.paymentMethod || "N/A")}<br/>
          <strong>Customer Name:</strong> ${escapeHtml(addr.fullName || payload.fullName || "N/A")}<br/>
          <strong>Email:</strong> ${escapeHtml(payload.email)}<br/>
          <strong>Phone:</strong> ${escapeHtml(addr.phone || "N/A")}<br/>
          <strong>Location:</strong> ${escapeHtml([addr.city, addr.state, addr.postalCode].filter(Boolean).join(", ") || "N/A")}<br/>
          <strong>Razorpay Order ID:</strong> ${escapeHtml(payload.razorpayOrderId || "N/A")}<br/>
          <strong>Razorpay Payment ID:</strong> ${escapeHtml(payload.razorpayPaymentId || "N/A")}</p>
          ${renderItemsTable(payload.items)}
          <p><strong>Attempted Value:</strong> ${formatINR(payload.totalInr)} ${payload.couponCode ? `(Coupon: ${escapeHtml(payload.couponCode)})` : ""}</p>
        `,
        buttons: [
          { label: "Email Customer to Assist", href: `mailto:${encodeURIComponent(payload.email || "")}?subject=${encodeURIComponent(`Assistance with DIVARA Order ${payload.orderNumber || ""}`)}` },
          { label: "Call Customer", href: `tel:${String(addr.phone || "").replace(/[^\d+]/g, "")}` },
        ],
      }),
    };
  }

  if (type === "SEND_ORDER_STATUS_UPDATE") {
    return {
      to: payload.email,
      subject: `Order ${payload.orderNumber} Update: ${payload.status} | DIVARA`,
      html: renderEmailShell({
        eyebrow: "Order Status Update",
        title: `Your Order Is Now ${payload.status}`,
        bodyHtml: `
          <p>Dear ${escapeHtml(payload.fullName || "Valued Client")},</p>
          <p>The status of your DIVARA order <strong>${escapeHtml(payload.orderNumber)}</strong> has been updated to <strong>${escapeHtml(payload.status)}</strong>.</p>
          ${payload.trackingNumber ? `<p><strong>Courier:</strong> ${escapeHtml(payload.courierName || "Insured Partner")}<br/><strong>Tracking Number:</strong> ${escapeHtml(payload.trackingNumber)}</p>` : ""}
        `,
        buttons: [{ label: "Track Order in Account", href: `${SITE_URL}/account` }],
      }),
    };
  }

  if (type === "SEND_CONTACT_ACK") {
    return {
      to: payload.email,
      subject: `We Received Your Inquiry (${payload.ticketNumber}) | DIVARA`,
      html: renderEmailShell({
        eyebrow: "Client Support Acknowledgment",
        title: `Thank You for Reaching Out, ${payload.name || "Guest"}`,
        bodyHtml: `
          <p>We have logged your inquiry regarding <strong>&ldquo;${escapeHtml(payload.subject)}&rdquo;</strong> under reference <strong>${escapeHtml(payload.ticketNumber)}</strong>.</p>
          <p>You can view your inquiry and any replies from our team directly on the DIVARA Contact page.</p>
        `,
        buttons: [{ label: "View Inquiry on Contact Page", href: `${SITE_URL}/contact#ticket-${encodeURIComponent(payload.ticketNumber || "")}` }],
      }),
    };
  }

  if (type === "SEND_ADMIN_NEW_TICKET") {
    return {
      to: ADMIN_EMAIL,
      subject: `[NEW INQUIRY] ${payload.ticketNumber}: ${payload.subject} | DIVARA`,
      html: renderEmailShell({
        eyebrow: "New Contact Form Submission",
        title: `${payload.subject} (${payload.ticketNumber})`,
        bodyHtml: `
          <p><strong>From:</strong> ${escapeHtml(payload.name)} (${escapeHtml(payload.email)})<br/>
          <strong>Submitted:</strong> ${escapeHtml(formatIST(payload.createdAt))}</p>
          <blockquote style="border-left:3px solid #5d100a;padding-left:14px;margin:14px 0;color:#1b1717;white-space:pre-wrap;">${escapeHtml(payload.message)}</blockquote>
        `,
        buttons: [{ label: "Reply in Admin Panel", href: `${SITE_URL}/account?tab=tickets` }],
      }),
    };
  }

  if (type === "SEND_CONTACT_ADMIN_REPLY") {
    return {
      to: payload.email,
      subject: `DIVARA Replied to Your Inquiry (${payload.ticketNumber})`,
      html: renderEmailShell({
        eyebrow: "New Reply from DIVARA Atelier",
        title: `Response to "${payload.subject}"`,
        bodyHtml: `
          <p>Dear ${escapeHtml(payload.name || "Valued Client")},</p>
          <p><strong>${escapeHtml(payload.adminName || "DIVARA Client Support")}</strong> replied to your inquiry (<strong>${escapeHtml(payload.ticketNumber)}</strong>):</p>
          <blockquote style="border-left:3px solid #5d100a;padding:12px 16px;background:#f8f6f4;margin:16px 0;color:#1b1717;white-space:pre-wrap;">${escapeHtml(payload.replyMessage)}</blockquote>
          <p>Click below to view the full thread and reply directly on our Contact page.</p>
        `,
        buttons: [{ label: "View & Reply on Contact Page", href: `${SITE_URL}/contact#ticket-${encodeURIComponent(payload.ticketNumber || "")}` }],
      }),
    };
  }

  if (type === "SEND_NEWSLETTER_WELCOME") {
    return {
      to: payload.email,
      subject: "Welcome to DIVARA — Seasonal Lookbooks & Private Releases",
      html: renderEmailShell({
        eyebrow: "DIVARA Dispatches",
        title: "You Are on the Private Dispatch List",
        bodyHtml: `<p>Thank you for subscribing. You will be the first to receive our seasonal lookbooks, artisan weave stories, and private release invitations.</p>`,
        buttons: [{ label: "Browse Latest Collection", href: `${SITE_URL}/collections` }],
      }),
    };
  }

  return {
    to: ADMIN_EMAIL,
    subject: `[URGENT CONCIERGE] Order Review Required — ${payload.orderNumber}`,
    html: renderEmailShell({
      eyebrow: "Urgent Order Reconciliation",
      title: `Manual Review Needed: ${payload.orderNumber}`,
      bodyHtml: `<p>Order <strong>${escapeHtml(payload.orderNumber)}</strong> (${escapeHtml(payload.email)}) requires manual attention.${payload.note ? ` ${escapeHtml(payload.note)}` : " Late payment capture after hold expiry — please verify stock or issue a refund."}</p>`,
      buttons: [{ label: "Open Admin Orders", href: `${SITE_URL}/account?tab=orders` }],
    }),
  };
}

async function pollNextJobs() {
  if (isProcessing) return;
  isProcessing = true;

  try {
    await Job.updateMany(
      {
        status: "PROCESSING",
        updatedAt: { $lte: new Date(Date.now() - STALE_LOCK_MS) },
      },
      { $set: { status: "PENDING" } }
    );

    for (let i = 0; i < MAX_JOBS_PER_TICK; i++) {
      const job = await Job.findOneAndUpdate(
        { status: "PENDING", runAt: { $lte: new Date() } },
        { $set: { status: "PROCESSING" }, $inc: { attempts: 1 } },
        { sort: { createdAt: 1 }, returnDocument: "after" }
      );

      if (!job) break;

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
        console.error(
          `[JobWorker] Job ${job._id} (${job.type}) failed (attempt ${job.attempts}/${job.maxAttempts}):`,
          err.message
        );
        job.lastError = err.message;
        if (job.attempts >= job.maxAttempts) {
          job.status = "FAILED";
        } else {
          job.status = "PENDING";
          job.runAt = new Date(Date.now() + job.attempts * 30_000);
        }
        await job.save();
      }

      // Respect Resend's 2 req/sec rate limit when draining multiple queued emails
      await sleep(SEND_THROTTLE_MS);
    }
  } catch (pollErr) {
    console.error("[JobWorker] Poll error:", pollErr.message);
  } finally {
    isProcessing = false;
  }
}

export function startJobWorker(intervalMs = 5000) {
  workerTimer = setInterval(pollNextJobs, intervalMs);
  return {
    stop: () => workerTimer && clearInterval(workerTimer),
  };
}