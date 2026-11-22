import { Router } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { VALID_SIZES } from "../../models/Product.js";
import {
  getAdminOverview,
  adminListUtmLinks,
  adminCreateUtmLink,
  adminDeleteUtmLink,
  adminListProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminToggleProductActive,
  adminReorderProducts,
  adminAdjustProductStock,
  adminDeleteProduct,
  adminListOrders,
  adminUpdateOrderStatus,
  adminReviewReturn,
  adminRefundOrder,
  adminUpdateSiteContent,
  adminUpdatePolicy,
  adminListLogs,
  superAdminListAdmins,
  superAdminCreateAdmin,
  superAdminToggleAdmin,
  superAdminDeleteAdmin,
} from "../../controllers/admin.controller.js";
import {
  adminListUsers,
  adminGetUserDetail,
  adminCreateUser,
  adminUpdateUser,
  adminToggleUserBan,
  adminRevokeUserSessions,
  adminClearUserCart,
  adminDeleteUser,
} from "../../controllers/adminUsers.controller.js";
import {
  adminListVisitors,
  adminGetProfileIntelligence,
} from "../../controllers/adminActivity.controller.js";

const router = Router();

const orderStatusSchema = z.object({
  status: z.enum([
    "PENDING_PAYMENT",
    "PAID",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "RETURN_REQUESTED",
    "RETURN_APPROVED",
    "RETURN_REJECTED",
    "CANCELLED",
    "CONCIERGE_REVIEW",
    "REFUNDED",
  ]),
  trackingNumber: z.string().trim().max(120).optional(),
  courierName: z.string().trim().max(120).optional(),
});

const reviewReturnSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  adminNote: z.string().trim().max(500).optional().default(""),
});

const refundOrderSchema = z.object({
  reason: z.string().trim().max(300).optional().default("Refund approved by DIVARA Atelier"),
  restock: z.boolean().optional().default(true),
});

const createAdminSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email("Valid login email required"),
  notificationEmail: z.string().email("Valid OTP inbox email required").optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const createCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email("Valid email required"),
  phone: z.string().trim().max(24).optional().default(""),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
});

const updateCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(100).optional(),
  phone: z.string().trim().max(24).optional(),
});

const createUtmLinkSchema = z.object({
  label: z.string().trim().min(2).max(140),
  targetPath: z.string().trim().max(260).optional().default("/"),
  utmSource: z.string().trim().min(1).max(80),
  utmMedium: z.string().trim().min(1).max(80),
  utmCampaign: z.string().trim().max(120).optional().default(""),
  utmContent: z.string().trim().max(120).optional().default(""),
  referralPerson: z.string().trim().max(100).optional().default(""),
});

const reorderProductsSchema = z.object({
  orderedIds: z.array(z.string().min(12)).min(1),
});

const adjustStockSchema = z.object({
  size: z.enum(VALID_SIZES),
  delta: z.number().int().min(-500).max(500).optional(),
  stockOnHand: z.number().int().min(0).max(10000).optional(),
});

router.use(requireAuth, requireAdmin);

router.get("/overview", getAdminOverview);

router.get("/utm-links", adminListUtmLinks);
router.post("/utm-links", validate(createUtmLinkSchema), adminCreateUtmLink);
router.delete("/utm-links/:linkId", adminDeleteUtmLink);

router.get("/products", adminListProducts);
router.post("/products", adminCreateProduct);
router.patch("/products/reorder", validate(reorderProductsSchema), adminReorderProducts);
router.patch("/products/:productId", adminUpdateProduct);
router.patch("/products/:productId/toggle-active", adminToggleProductActive);
router.patch("/products/:productId/stock", validate(adjustStockSchema), adminAdjustProductStock);
router.delete("/products/:productId", adminDeleteProduct);

router.get("/orders", adminListOrders);
router.patch("/orders/:orderId/status", validate(orderStatusSchema), adminUpdateOrderStatus);
router.patch("/orders/:orderId/return", validate(reviewReturnSchema), adminReviewReturn);
router.post("/orders/:orderId/refund", validate(refundOrderSchema), adminRefundOrder);

router.get("/users", adminListUsers);
router.post("/users", validate(createCustomerSchema), adminCreateUser);
router.get("/users/:userId", adminGetUserDetail);
router.patch("/users/:userId", validate(updateCustomerSchema), adminUpdateUser);
router.patch("/users/:userId/toggle-ban", adminToggleUserBan);
router.post("/users/:userId/revoke-sessions", adminRevokeUserSessions);
router.delete("/users/:userId/cart", adminClearUserCart);
router.delete("/users/:userId", adminDeleteUser);

// Anonymous Visitors & Behavioral Intelligence Endpoints
router.get("/visitors", adminListVisitors);
router.get("/profiles/:type/:id/intelligence", adminGetProfileIntelligence);

router.put("/cms/site-content", adminUpdateSiteContent);
router.put("/policies/:slug", adminUpdatePolicy);

router.get("/logs", adminListLogs);

router.get("/team", requireSuperAdmin, superAdminListAdmins);
router.post("/team", requireSuperAdmin, validate(createAdminSchema), superAdminCreateAdmin);
router.patch("/team/:adminId/toggle", requireSuperAdmin, superAdminToggleAdmin);
router.delete("/team/:adminId", requireSuperAdmin, superAdminDeleteAdmin);

export default router;