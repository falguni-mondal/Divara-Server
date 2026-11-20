import { Job } from "../models/Job.js";
import { sendEmail } from "../config/resend.js";
import { env } from "../config/env.js";

let workerTimer = null;
let isProcessing = false;

const SITE_URL = env.CLIENT_ORIGIN.replace(/\/$/, "");
const ADMIN_EMAIL = env.ADMIN_NOTIFICATION_EMAIL;

function formatIST(dateValue) {
  return new Date(dateValue || Date.now()).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " IST";
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
            return `<a href="${btn.href}" style="display:inline-block;margin:0 10px 10px 0;padding:12px 24px;background:${bg};color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:11px;letter-spacing:0.18em;text-transform:uppercase;font-weight:600;border-radius:2px;">${btn.label}</a>`;
          })
          .join("")}</div>`
      : "";

  return `
    <div style="background:#f8f6f4;padding:32px 16px;font-family:Georgia,serif;color:#1b1717;">
      <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e6e2de;padding:36px 32px;">
        <div style="border-bottom:2px solid #5d100a;padding-bottom:16px;margin-bottom:24px;">
          <div style="font-size:22px;letter-spacing:0.28em;color:#1b1717;font-weight:400;">DIVARA</div>
          <div style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:#5d100a;margin-top:6px;">${eyebrow}</div>
        </div>
        <h2 style="font-size:22px;font-weight:400;margin:0 0 16px;color:#1b1717;">${title}</h2>
        <div style="font-family:Arial,sans-serif;font-size:13.5px;line-height:1.7;color:#332d2d;">
          ${bodyHtml}
        </div>
        ${buttonRow}
        <div style="margin-top:32px;padding-top:18px;border-top:1px solid #e6e2de;font-family:Arial,sans-serif;font-size:11px;color:#756d6d;">
          DIVARA Atelier • Kolkata • Mumbai • New Delhi<br/>
          <a href="${SITE_URL}" style="color:#5d100a;text-decoration:none;">divara.byfalguni.com</a> &nbsp;|&nbsp; support@divara.byfalguni.com
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
        <td style="padding:8px 0;border-bottom:1px solid #eee;"><strong>${i.title}</strong><br/><span style="font-size:11px;color:#666;">Size: ${i.size} • SKU: ${i.sku || "N/A"}</span></td>
        <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">× ${i.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #eee;text-align:right;">${formatINR(i.unitPrice * i.quantity)}</td>
      </tr>`
    )
    .join("");

  return `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12.5px;">${rows}</table>`;
}

function buildEmailFromJob(job) {
  const { type, payload } = job;

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
    return {
      to: payload.email,
      subject: `Order Confirmed — ${payload.orderNumber} | DIVARA`,
      html: renderEmailShell({
        eyebrow: "Order Confirmation",
        title: `Thank You for Your Order, ${payload.fullName}`,
        bodyHtml: `
          <p>We have received your payment and reserved your handwoven piece(s) at our atelier.</p>
          <p><strong>Order Number:</strong> ${payload.orderNumber}<br/>
          <strong>Placed On:</strong> ${formatIST(payload.paidAt)}</p>
          ${renderItemsTable(payload.items)}
          <p style="margin-top:12px;">
            Subtotal: ${formatINR(payload.subtotalInr)}<br/>
            ${payload.discountInr > 0 ? `Discount (${payload.couponCode}): -${formatINR(payload.discountInr)}<br/>` : ""}
            GST (12%): ${formatINR(payload.gstInr)}<br/>
            <strong>Total Paid: ${formatINR(payload.totalInr)}</strong>
          </p>
          <p><strong>Shipping To:</strong><br/>
          ${addr.fullName || payload.fullName}, ${addr.line1 || ""} ${addr.line2 || ""}, ${addr.city || ""}, ${addr.state || ""} - ${addr.postalCode || ""} (${addr.phone || ""})</p>
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
          <p><strong>Date &amp; Time:</strong> ${formatIST(payload.paidAt)}<br/>
          <strong>Customer:</strong> ${addr.fullName || payload.fullName}<br/>
          <strong>Email:</strong> ${payload.email} &nbsp;|&nbsp; <strong>Phone:</strong> ${addr.phone || "N/A"}<br/>
          <strong>Address:</strong> ${addr.line1 || ""} ${addr.line2 || ""}, ${addr.city || ""}, ${addr.state || ""} - ${addr.postalCode || ""}<br/>
          <strong>Razorpay Order:</strong> ${payload.razorpayOrderId || "N/A"}<br/>
          <strong>Razorpay Payment:</strong> ${payload.razorpayPaymentId || "N/A"}</p>
          ${renderItemsTable(payload.items)}
          <p><strong>Subtotal:</strong> ${formatINR(payload.subtotalInr)} &nbsp;|&nbsp;
          ${payload.discountInr > 0 ? `<strong>Coupon (${payload.couponCode}):</strong> -${formatINR(payload.discountInr)} &nbsp;|&nbsp;` : ""}
          <strong>GST:</strong> ${formatINR(payload.gstInr)} &nbsp;|&nbsp;
          <strong>Total Paid:</strong> ${formatINR(payload.totalInr)}</p>
        `,
        buttons: [
          { label: "Open Admin Panel", href: `${SITE_URL}/admin/orders` },
          { label: "Email Customer", href: `mailto:${payload.email}?subject=Your%20DIVARA%20Order%20${payload.orderNumber}` },
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
          <p style="color:#5d100a;font-weight:600;">Failure Reason: ${payload.failureReason || "Payment declined or checkout hold expired"}</p>
          <p><strong>Date &amp; Time:</strong> ${formatIST(payload.failedAt)}<br/>
          <strong>Error Code / Method:</strong> ${payload.errorCode || "N/A"} / ${payload.paymentMethod || "N/A"}<br/>
          <strong>Customer Name:</strong> ${addr.fullName || payload.fullName || "N/A"}<br/>
          <strong>Email:</strong> ${payload.email}<br/>
          <strong>Phone:</strong> ${addr.phone || "N/A"}<br/>
          <strong>Location:</strong> ${addr.city || "N/A"}, ${addr.state || "N/A"} - ${addr.postalCode || "N/A"}<br/>
          <strong>Razorpay Order ID:</strong> ${payload.razorpayOrderId || "N/A"}<br/>
          <strong>Razorpay Payment ID:</strong> ${payload.razorpayPaymentId || "N/A"}</p>
          ${renderItemsTable(payload.items)}
          <p><strong>Attempted Value:</strong> ${formatINR(payload.totalInr)} ${payload.couponCode ? `(Coupon: ${payload.couponCode})` : ""}</p>
        `,
        buttons: [
          { label: "Email Customer to Assist", href: `mailto:${payload.email}?subject=Assistance%20with%20DIVARA%20Order%20${payload.orderNumber}` },
          { label: "Call Customer", href: `tel:${(addr.phone || "").replace(/\s+/g, "")}` },
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
          <p>Dear ${payload.fullName},</p>
          <p>The status of your DIVARA order <strong>${payload.orderNumber}</strong> has been updated to <strong>${payload.status}</strong>.</p>
          ${payload.trackingNumber ? `<p><strong>Courier:</strong> ${payload.courierName || "Insured Partner"}<br/><strong>Tracking Number:</strong> ${payload.trackingNumber}</p>` : ""}
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
        title: `Thank You for Reaching Out, ${payload.name}`,
        bodyHtml: `
          <p>We have logged your inquiry regarding <strong>"${payload.subject}"</strong> under reference <strong>${payload.ticketNumber}</strong>.</p>
          <p>You can view your inquiry and any replies from our team directly on the DIVARA Contact page.</p>
        `,
        buttons: [{ label: "View Inquiry on Contact Page", href: `${SITE_URL}/contact#ticket-${payload.ticketNumber}` }],
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
          <p><strong>From:</strong> ${payload.name} (${payload.email})<br/>
          <strong>Submitted:</strong> ${formatIST(payload.createdAt)}</p>
          <blockquote style="border-left:3px solid #5d100a;padding-left:14px;margin:14px 0;color:#1b1717;">${payload.message}</blockquote>
        `,
        buttons: [{ label: "Reply in Admin Panel", href: `${SITE_URL}/admin/tickets` }],
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
          <p>Dear ${payload.name},</p>
          <p><strong>${payload.adminName || "DIVARA Client Support"}</strong> replied to your inquiry (<strong>${payload.ticketNumber}</strong>):</p>
          <blockquote style="border-left:3px solid #5d100a;padding:12px 16px;background:#f8f6f4;margin:16px 0;color:#1b1717;">${payload.replyMessage}</blockquote>
          <p>Click below to view the full thread and reply directly on our Contact page.</p>
        `,
        buttons: [{ label: "View & Reply on Contact Page", href: `${SITE_URL}/contact#ticket-${payload.ticketNumber}` }],
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
    subject: `[URGENT CONCIERGE] Late Webhook Stock Review — ${payload.orderNumber}`,
    html: renderEmailShell({
      eyebrow: "Urgent Stock Reconciliation",
      title: `Manual Review Needed: ${payload.orderNumber}`,
      bodyHtml: `<p>Order <strong>${payload.orderNumber}</strong> (${payload.email}) received a late payment capture after hold expiry. Please verify stock or issue a refund.</p>`,
      buttons: [{ label: "Open Admin Panel", href: `${SITE_URL}/admin/orders` }],
    }),
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