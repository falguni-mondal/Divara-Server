import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { optionalAuth } from "../../middlewares/auth.middleware.js";
import { identifyDevice, ingestBatch } from "../../controllers/activity.controller.js";

const router = Router();

const activityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: "RATE_LIMITED",
      message: "Activity rate limit exceeded.",
    },
  },
});

// Parse text/plain JSON payloads sent by navigator.sendBeacon() on tab/browser exit
const beaconTextParser = express.text({ type: "text/plain", limit: "64kb" });

router.post("/identify", activityLimiter, optionalAuth, identifyDevice);
router.post("/batch", activityLimiter, beaconTextParser, optionalAuth, ingestBatch);

export default router;