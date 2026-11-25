import express, { Router } from "express";
import { requireAuth, requireAdmin } from "../../middlewares/auth.middleware.js";
import { formRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import {
  getImageKitUploadAuth,
  uploadCustomerReviewImage,
  removeImageKitAsset,
} from "../../controllers/media.controller.js";

const router = Router();

// Server-proxied, magic-byte-validated review image upload (max 3 MB, locked to /divara/reviews)
router.post(
  "/review-upload",
  requireAuth,
  formRateLimiter,
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "3mb" }),
  uploadCustomerReviewImage
);

// Admin-only ImageKit upload auth & asset deletion
router.get("/imagekit-auth", requireAuth, requireAdmin, getImageKitUploadAuth);
router.delete("/:fileId", requireAuth, requireAdmin, removeImageKitAsset);

export default router;