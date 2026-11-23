import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { env } from "../../config/env.js";
import { optionalAuth } from "../../middlewares/auth.middleware.js";
import {
  clearMyAiMemory,
  getMyAiMemory,
  handleAiChat,
  handleAiTranscribe,
} from "../../controllers/ai.controller.js";

const router = Router();
const isDev = env.NODE_ENV !== "production";

function blockStaffRoles(req, res, next) {
  if (req.user && req.user.role !== "customer") {
    return res.status(403).json({
      success: false,
      error: {
        code: "STOREFRONT_ONLY",
        message: "DIVARA Concierge is available only for storefront shoppers.",
      },
    });
  }
  return next();
}

function aiRateKey(req) {
  if (req.user?._id) return `u:${req.user._id}`;
  const did = req.cookies?.divara_did || req.headers["x-divara-device-id"] || "";
  return `v:${req.ip}:${String(did).slice(0, 32)}`;
}

const aiChatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: (req) => (isDev ? 200 : req.user ? 60 : 25),
  keyGenerator: aiRateKey,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: (req) => ({
    success: false,
    error: {
      code: "CONCIERGE_LIMIT",
      message: req.user
        ? "Hourly limit reached. Please try again shortly."
        : "Hourly limit reached, Login for more chats.",
    },
  }),
});

const aiVoiceLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: (req) => (isDev ? 120 : req.user ? 30 : 12),
  keyGenerator: aiRateKey,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: (req) => ({
    success: false,
    error: {
      code: "VOICE_LIMIT",
      message: req.user
        ? "Hourly voice limit reached. You can continue by typing."
        : "Hourly voice limit reached, Login for more voice chats.",
    },
  }),
});

router.use(optionalAuth, blockStaffRoles);

router.post("/chat", aiChatLimiter, handleAiChat);
router.post(
  "/transcribe",
  aiVoiceLimiter,
  express.raw({ type: ["audio/*", "application/octet-stream"], limit: "4mb" }),
  handleAiTranscribe
);
router.get("/memory", getMyAiMemory);
router.delete("/memory", clearMyAiMemory);

export default router;