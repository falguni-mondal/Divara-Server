import { Router } from "express";
import { z } from "zod";
import {
  requireAuth,
  optionalAuth,
  requireAdmin,
} from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { formRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import {
  listProductReviews,
  createProductReview,
  deleteMyReview,
  adminListReviews,
  adminUpdateReviewStatus,
  adminSeedReviews,
  adminDeleteReview,
  addReviewReply,
  deleteReviewReply,
} from "../../controllers/review.controller.js";

const router = Router();

const imageItemSchema = z.object({
  url: z.string().url(),
  fileId: z.string().min(1),
});

const createReviewSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  title: z.string().trim().min(3).max(140),
  comment: z.string().trim().min(10).max(2000),
  images: z.array(imageItemSchema).max(3, "Maximum 3 images allowed").optional().default([]),
});

const replySchema = z.object({
  comment: z.string().trim().min(2).max(1500),
  parentReplyId: z.string().nullable().optional().default(null),
});

const adminStatusSchema = z.object({
  status: z.enum(["PUBLISHED", "PENDING", "HIDDEN"]),
});

const adminSeedSchema = z.object({
  productSlug: z.string().trim().min(1),
  reviews: z
    .array(
      z.object({
        reviewerName: z.string().trim().min(2).max(80),
        rating: z.coerce.number().int().min(1).max(5),
        title: z.string().trim().min(3).max(140),
        comment: z.string().trim().min(10).max(2000),
        images: z.array(imageItemSchema).max(3).optional().default([]),
        isVerifiedPurchase: z.boolean().optional().default(true),
        createdAt: z.string().datetime().optional(),
      })
    )
    .min(1)
    .max(50),
});

// Admin Panel review moderation & seeding
router.get("/admin/list", requireAuth, requireAdmin, adminListReviews);
router.patch(
  "/admin/:reviewId/status",
  requireAuth,
  requireAdmin,
  validate(adminStatusSchema),
  adminUpdateReviewStatus
);
router.post("/admin/seed", requireAuth, requireAdmin, validate(adminSeedSchema), adminSeedReviews);
router.delete("/admin/:reviewId", requireAuth, requireAdmin, adminDeleteReview);

// Customer reviews & infinite nested replies (optionalAuth lets authors see their own PENDING review)
router.get("/:slug", optionalAuth, listProductReviews);
router.post("/:slug", requireAuth, formRateLimiter, validate(createReviewSchema), createProductReview);
router.delete("/item/:reviewId", requireAuth, deleteMyReview);
router.post("/:reviewId/replies", requireAuth, formRateLimiter, validate(replySchema), addReviewReply);
router.delete("/:reviewId/replies/:replyId", requireAuth, deleteReviewReply);

export default router;