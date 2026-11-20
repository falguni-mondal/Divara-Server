import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.middleware.js";
import { formRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import { submitContactTicket, subscribeNewsletter } from "../../controllers/crm.controller.js";

const router = Router();

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email(),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(4000),
});

const newsletterSchema = z.object({
  email: z.string().email(),
});

router.post("/contact", formRateLimiter, validate(contactSchema), submitContactTicket);
router.post("/newsletter", formRateLimiter, validate(newsletterSchema), subscribeNewsletter);

export default router;