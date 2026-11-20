import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { env } from "../../config/env.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { authRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import {
  identifyEmail,
  emailPasswordContinue,
  googleCallback,
  refreshSession,
  logout,
  getMe,
} from "../../controllers/auth.controller.js";

const router = Router();

const identifySchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const continueSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  fullName: z.string().trim().max(100).optional(),
});

router.post("/identify", authRateLimiter, validate(identifySchema), identifyEmail);
router.post("/continue", authRateLimiter, validate(continueSchema), emailPasswordContinue);
router.post("/refresh", authRateLimiter, refreshSession);
router.post("/logout", logout);
router.get("/me", requireAuth, getMe);

router.get(
  "/google",
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    prompt: "select_account",
  })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    session: false,
    failureRedirect: `${env.CLIENT_ORIGIN}/account?auth=failed`,
  }),
  googleCallback
);

export default router;