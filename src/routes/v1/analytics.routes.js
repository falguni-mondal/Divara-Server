import { Router } from "express";
import { z } from "zod";
import { validate } from "../../middlewares/validate.middleware.js";
import { trackVisit } from "../../controllers/analytics.controller.js";

const router = Router();

const trackSchema = z.object({
  sessionId: z.string().trim().min(6).max(80),
  landingPath: z.string().trim().max(300).optional().default("/"),
  utmSource: z.string().trim().max(80).optional().default(""),
  utmMedium: z.string().trim().max(80).optional().default(""),
  utmCampaign: z.string().trim().max(120).optional().default(""),
  utmContent: z.string().trim().max(120).optional().default(""),
  referralPerson: z.string().trim().max(100).optional().default(""),
  referrerHost: z.string().trim().max(260).optional().default(""),
});

router.post("/track", validate(trackSchema), trackVisit);

export default router;