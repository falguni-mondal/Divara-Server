import crypto from "crypto";
import { SupportTicket } from "../models/SupportTicket.js";
import { Newsletter } from "../models/Newsletter.js";
import { Job } from "../models/Job.js";
import { sendSuccess } from "../utils/apiResponse.js";

export async function submitContactTicket(req, res) {
  const { name, email, subject, message } = req.body;
  const ticketNumber = `TKT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  const ticket = await SupportTicket.create({
    ticketNumber,
    name,
    email,
    subject,
    message,
    assignedBoutique: "Kolkata",
  });

  await Job.create({
    type: "SEND_CONTACT_ACK",
    idempotencyKey: `contact-ack-${ticketNumber}`,
    payload: { ticketNumber, name, email, subject },
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: "Message received. Our team will respond within 24 hours.",
    data: { ticketNumber: ticket.ticketNumber },
  });
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