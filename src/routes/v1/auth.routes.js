import { Router } from "express";
import passport from "passport";
import { z } from "zod";
import { env } from "../../config/env.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { requireAuth, optionalAuth } from "../../middlewares/auth.middleware.js";
import { authRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import {
  identifyEmail,
  emailPasswordContinue,
  requestSuperAdminEmailOtp,
  verifyEmailOtp,
  verifySuperAdminTotp,
  googleCallback,
  refreshSession,
  logout,
  getMe,
} from "../../controllers/auth.controller.js";
import {
  listMyAddresses,
  addMyAddress,
  updateMyAddress,
  deleteMyAddress,
} from "../../controllers/address.controller.js";

const router = Router();

const identifySchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

const continueSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  fullName: z.string().trim().max(100).optional(),
});

const verifyOtpSchema = z.object({
  email: z.string().email(),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
  purpose: z.enum(["CUSTOMER_REGISTER", "ADMIN_LOGIN"]),
});

const verifyTotpSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "Authenticator code must be 6 digits"),
});

const addressSchema = z.object({
  label: z.string().trim().min(1).max(40).optional().default("Home"),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(10).max(20),
  line1: z.string().trim().min(4).max(200),
  line2: z.string().trim().max(200).optional().default(""),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().min(5).max(12),
  country: z.string().trim().default("India"),
  isDefault: z.boolean().optional().default(false),
});

router.post("/identify", authRateLimiter, validate(identifySchema), identifyEmail);
router.post("/continue", authRateLimiter, validate(continueSchema), emailPasswordContinue);
router.post(
  "/super-admin-email-otp",
  authRateLimiter,
  validate(continueSchema),
  requestSuperAdminEmailOtp
);
router.post("/verify-otp", authRateLimiter, validate(verifyOtpSchema), verifyEmailOtp);
router.post("/verify-totp", authRateLimiter, validate(verifyTotpSchema), verifySuperAdminTotp);
router.post("/refresh", authRateLimiter, refreshSession);
router.post("/logout", optionalAuth, logout);
router.get("/me", requireAuth, getMe);

// Customer Saved Addresses Manager
router.get("/addresses", requireAuth, listMyAddresses);
router.post("/addresses", requireAuth, validate(addressSchema), addMyAddress);
router.patch("/addresses/:addressId", requireAuth, validate(addressSchema.partial()), updateMyAddress);
router.delete("/addresses/:addressId", requireAuth, deleteMyAddress);

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