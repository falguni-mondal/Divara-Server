import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireAdmin } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { CATEGORY_LABELS } from "../../models/Product.js";
import {
  validateCoupon,
  getAutoApplicableCoupon,
  adminListCoupons,
  adminCreateCoupon,
  adminUpdateCoupon,
  adminDeleteCoupon,
} from "../../controllers/coupon.controller.js";

const router = Router();
const validCategories = z.enum(Object.keys(CATEGORY_LABELS));

const applySchema = z.object({
  code: z.string().trim().min(2).max(40),
});

const couponPayloadSchema = z.object({
  code: z.string().trim().min(2).max(40),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).optional().default(""),
  discountType: z.enum(["PERCENTAGE", "FIXED"]),
  discountValue: z.coerce.number().positive(),
  maxDiscountInr: z.coerce.number().positive().nullable().optional().default(null),
  applyMode: z.enum(["MANUAL", "AUTO"]).default("MANUAL"),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().nullable().optional().default(null),
  maxTotalUses: z.coerce.number().int().positive().nullable().optional().default(null),
  maxUsesPerUser: z.coerce.number().int().positive().nullable().optional().default(1),
  applicableTo: z
    .enum(["ALL", "SPECIFIC_PRODUCTS", "SPECIFIC_CATEGORIES", "SPECIFIC_SEASONS"])
    .default("ALL"),
  productIds: z.array(z.string()).optional().default([]),
  categories: z.array(validCategories).optional().default([]),
  seasons: z.array(z.enum(["Winter", "Spring", "Summer", "Autumn"])).optional().default([]),
  eligibleUserIds: z.array(z.string()).optional().default([]),
  eligibleEmails: z.array(z.string().email()).optional().default([]),
  firstOrderOnly: z.boolean().optional().default(false),
  minOrderSubtotal: z.coerce.number().min(0).optional().default(0),
  minItemQuantity: z.coerce.number().int().min(1).optional().default(1),
  isActive: z.boolean().optional().default(true),
});

// Customer endpoints
router.post("/validate", requireAuth, validate(applySchema), validateCoupon);
router.get("/auto", requireAuth, getAutoApplicableCoupon);

// Admin Panel CRUD endpoints
router.get("/admin", requireAuth, requireAdmin, adminListCoupons);
router.post("/admin", requireAuth, requireAdmin, validate(couponPayloadSchema), adminCreateCoupon);
router.patch(
  "/admin/:couponId",
  requireAuth,
  requireAdmin,
  validate(couponPayloadSchema.partial()),
  adminUpdateCoupon
);
router.delete("/admin/:couponId", requireAuth, requireAdmin, adminDeleteCoupon);

export default router;