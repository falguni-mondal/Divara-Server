import { Router } from "express";
import { z } from "zod";
import { optionalAuth, requireAuth, requireAdmin } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { formRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import {
  submitContactTicket,
  getMyTickets,
  userReplyToTicket,
  adminListTickets,
  adminReplyToTicket,
  adminUpdateTicketStatus,
  subscribeNewsletter,
} from "../../controllers/crm.controller.js";

const router = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(4000),
});

const replySchema = z.object({
  message: z.string().trim().min(2).max(3000),
  parentReplyId: z.string().nullable().optional().default(null),
});

const statusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED"]),
  adminNotes: z.string().max(2000).optional(),
});

const newsletterSchema = z.object({
  email: z.string().email(),
});

// Public / Authenticated User Contact & Threaded Replies
router.post("/contact", formRateLimiter, optionalAuth, validate(contactSchema), submitContactTicket);
router.get("/contact/my-tickets", requireAuth, getMyTickets);
router.post("/contact/:ticketId/reply", requireAuth, formRateLimiter, validate(replySchema), userReplyToTicket);
router.post("/newsletter", formRateLimiter, validate(newsletterSchema), subscribeNewsletter);

// Admin Panel Ticket Management
router.get("/admin/tickets", requireAuth, requireAdmin, adminListTickets);
router.post("/admin/tickets/:ticketId/reply", requireAuth, requireAdmin, validate(replySchema), adminReplyToTicket);
router.patch("/admin/tickets/:ticketId/status", requireAuth, requireAdmin, validate(statusSchema), adminUpdateTicketStatus);

export default router;