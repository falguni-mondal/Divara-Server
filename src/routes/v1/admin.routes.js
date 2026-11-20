import { Router } from "express";
import { z } from "zod";
import {
  requireAuth,
  requireAdmin,
  requireSuperAdmin,
} from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  getAdminOverview,
  adminListUtmLinks,
  adminCreateUtmLink,
  adminDeleteUtmLink,
  adminListProducts,
  adminCreateProduct,
  adminUpdateProduct,
  adminDeleteProduct,
  adminListOrders,
  adminUpdateOrderStatus,
  adminUpdateSiteContent,
  adminUpdatePolicy,
  adminListLogs,
  superAdminListAdmins,
  superAdminCreateAdmin,
  superAdminToggleAdmin,
  superAdminDeleteAdmin,
} from "../../controllers/admin.controller.js";

const router = Router();

const orderStatusSchema = z.object({
  status: z.enum([
    "PENDING_PAYMENT",
    "PAID",
    "PROCESSING",
    "SHIPPED",
    "DELIVERED",
    "CANCELLED",
    "CONCIERGE_REVIEW",
    "REFUNDED",
  ]),
  trackingNumber: z.string().trim().max(120).optional(),
  courierName: z.string().trim().max(120).optional(),
});

const createAdminSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().email("Valid login email required"),
  notificationEmail: z.string().email("Valid OTP inbox email required").optional(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
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

router.use(requireAuth, requireAdmin);

// Dashboard Telemetry
router.get("/overview", getAdminOverview);

// UTM & Referral URL Generator
router.get("/utm-links", adminListUtmLinks);
router.post("/utm-links", validate(createUtmLinkSchema), adminCreateUtmLink);
router.delete("/utm-links/:linkId", adminDeleteUtmLink);

// Products CRUD
router.get("/products", adminListProducts);
router.post("/products", adminCreateProduct);
router.patch("/products/:productId", adminUpdateProduct);
router.delete("/products/:productId", adminDeleteProduct);

// Orders
router.get("/orders", adminListOrders);
router.patch("/orders/:orderId/status", validate(orderStatusSchema), adminUpdateOrderStatus);

// CMS & Policies
router.put("/cms/site-content", adminUpdateSiteContent);
router.put("/policies/:slug", adminUpdatePolicy);

// Audit Logs
router.get("/logs", adminListLogs);

// Super Admin Only Team Management (strictly admin@divara.com)
router.get("/team", requireSuperAdmin, superAdminListAdmins);
router.post("/team", requireSuperAdmin, validate(createAdminSchema), superAdminCreateAdmin);
router.patch("/team/:adminId/toggle", requireSuperAdmin, superAdminToggleAdmin);
router.delete("/team/:adminId", requireSuperAdmin, superAdminDeleteAdmin);

export default router;