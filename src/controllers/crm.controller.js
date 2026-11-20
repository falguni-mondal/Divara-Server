import crypto from "crypto";
import { SupportTicket } from "../models/SupportTicket.js";
import { Newsletter } from "../models/Newsletter.js";
import { Job } from "../models/Job.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

function formatTicketDTO(t) {
  const replies = (t.replies || []).map((r) => ({
    id: String(r._id),
    parentReplyId: r.parentReplyId ? String(r.parentReplyId) : null,
    authorRole: r.authorRole,
    authorName: r.authorName,
    message: r.message,
    createdAt: r.createdAt,
  }));

  const hasAdminReply = replies.some((r) => r.authorRole === "admin");

  return {
    id: String(t._id),
    ticketNumber: t.ticketNumber,
    name: t.name,
    email: t.email,
    subject: t.subject,
    message: t.message,
    status: t.status,
    hasAdminReply,
    replies,
    createdAt: t.createdAt,
  };
}

export async function submitContactTicket(req, res) {
  const { name, email, subject, message } = req.body;
  const ticketNumber = `TKT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const ticket = await SupportTicket.create({
    ticketNumber,
    userId: req.user ? req.user._id : null,
    name,
    email: req.user ? req.user.email : email,
    subject,
    message,
    assignedBoutique: "Kolkata",
  });

  await Job.create([
    {
      type: "SEND_CONTACT_ACK",
      idempotencyKey: `contact-ack-${ticketNumber}`,
      payload: { ticketNumber, name, email: ticket.email, subject },
    },
    {
      type: "SEND_ADMIN_NEW_TICKET",
      idempotencyKey: `contact-admin-${ticketNumber}`,
      payload: { ticketNumber, name, email: ticket.email, subject, message, createdAt: ticket.createdAt },
    },
  ]);

  return sendSuccess(res, {
    statusCode: 201,
    message: "Message received. Our team will respond within 24 hours.",
    data: { ticket: formatTicketDTO(ticket) },
  });
}

/**
 * Returns the signed-in user's contact inquiries & nested replies for display on /contact.
 */
export async function getMyTickets(req, res) {
  const tickets = await SupportTicket.find({
    $or: [{ userId: req.user._id }, { email: req.user.email.toLowerCase() }],
  })
    .sort({ createdAt: -1 })
    .limit(30)
    .lean();

  return sendSuccess(res, {
    data: { tickets: tickets.map(formatTicketDTO) },
  });
}

/**
 * User reply on their own contact inquiry.
 * Strictly enforces: user can ONLY reply to an Admin reply (or after Admin has responded).
 */
export async function userReplyToTicket(req, res) {
  const { message, parentReplyId = null } = req.body;
  const ticket = await SupportTicket.findOne({
    _id: req.params.ticketId,
    $or: [{ userId: req.user._id }, { email: req.user.email.toLowerCase() }],
  });

  if (!ticket) {
    throw ApiError.notFound("Inquiry not found");
  }

  const hasAdminReplied = (ticket.replies || []).some((r) => r.authorRole === "admin");
  if (!hasAdminReplied) {
    throw ApiError.forbidden("You can reply once our DIVARA support team responds to your inquiry.");
  }

  if (parentReplyId) {
    const parent = ticket.replies.id(parentReplyId);
    if (!parent) throw ApiError.badRequest("Target reply not found");
    if (parent.authorRole === "user") {
      throw ApiError.forbidden("You can only reply to responses from DIVARA support.");
    }
  }

  ticket.replies.push({
    parentReplyId: parentReplyId || null,
    authorRole: "user",
    authorName: req.user.fullName?.trim() || ticket.name,
    authorId: req.user._id,
    message,
  });

  if (ticket.status === "RESOLVED") {
    ticket.status = "IN_PROGRESS";
  }

  await ticket.save();

  return sendSuccess(res, {
    statusCode: 201,
    message: "Your reply has been posted.",
    data: { ticket: formatTicketDTO(ticket) },
  });
}

// --- Admin Panel Ticket Management & Reply (Triggers Resend Email with Button) ---

export async function adminListTickets(_req, res) {
  const tickets = await SupportTicket.find().sort({ createdAt: -1 }).limit(100).lean();
  return sendSuccess(res, { data: { tickets: tickets.map(formatTicketDTO) } });
}

export async function adminReplyToTicket(req, res) {
  const { message, parentReplyId = null } = req.body;
  const ticket = await SupportTicket.findById(req.params.ticketId);
  if (!ticket) throw ApiError.notFound("Ticket not found");

  if (parentReplyId && !ticket.replies.id(parentReplyId)) {
    throw ApiError.badRequest("Parent reply not found");
  }

  const adminName = req.user.fullName?.trim() || "DIVARA Client Support";

  ticket.replies.push({
    parentReplyId: parentReplyId || null,
    authorRole: "admin",
    authorName: adminName,
    authorId: req.user._id,
    message,
  });
  ticket.status = "IN_PROGRESS";
  await ticket.save();

  const newReply = ticket.replies[ticket.replies.length - 1];

  await Job.create({
    type: "SEND_CONTACT_ADMIN_REPLY",
    idempotencyKey: `ticket-reply-${ticket.ticketNumber}-${newReply._id}`,
    payload: {
      ticketNumber: ticket.ticketNumber,
      name: ticket.name,
      email: ticket.email,
      subject: ticket.subject,
      adminName,
      replyMessage: message,
    },
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Reply posted and email notification queued for the user.",
    data: { ticket: formatTicketDTO(ticket) },
  });
}

export async function adminUpdateTicketStatus(req, res) {
  const ticket = await SupportTicket.findByIdAndUpdate(
    req.params.ticketId,
    { $set: { status: req.body.status, ...(req.body.adminNotes !== undefined ? { adminNotes: req.body.adminNotes } : {}) } },
    { returnDocument: "after" }
  );
  if (!ticket) throw ApiError.notFound("Ticket not found");

  return sendSuccess(res, { data: { ticket: formatTicketDTO(ticket) } });
}

export async function subscribeNewsletter(req, res) {
  const email = req.body.email.toLowerCase().trim();

  const existing = await Newsletter.findOne({ email });
  if (existing && existing.isSubscribed) {
    return sendSuccess(res, {
      message: "You are already subscribed to DIVARA dispatches.",
      data: { email, alreadySubscribed: true },
    });
  }

  await Newsletter.findOneAndUpdate(
    { email },
    { $set: { isSubscribed: true, unsubscribedAt: null, source: "footer" } },
    { upsert: true, returnDocument: "after" }
  );

  await Job.create({
    type: "SEND_NEWSLETTER_WELCOME",
    idempotencyKey: `newsletter-${email}-${new Date().toISOString().slice(0, 10)}`,
    payload: { email },
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Welcome to DIVARA. You are now subscribed.",
    data: { email, alreadySubscribed: false },
  });
}