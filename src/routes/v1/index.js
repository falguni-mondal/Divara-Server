import { Router } from "express";
import mongoose from "mongoose";
import authRoutes from "./auth.routes.js";
import catalogRoutes from "./catalog.routes.js";
import cmsRoutes from "./cms.routes.js";
import bagRoutes from "./bag.routes.js";
import checkoutRoutes from "./checkout.routes.js";
import couponRoutes from "./coupon.routes.js";
import reviewRoutes from "./review.routes.js";
import policyRoutes from "./policy.routes.js";
import crmRoutes from "./crm.routes.js";
import mediaRoutes from "./media.routes.js";
import adminRoutes from "./admin.routes.js";
import analyticsRoutes from "./analytics.routes.js";
import activityRoutes from "./activity.routes.js";

const router = Router();

router.get("/healthz", (_req, res) => {
  const dbReady = mongoose.connection.readyState === 1;
  res.status(dbReady ? 200 : 503).json({
    success: dbReady,
    service: "divara-server",
    database: dbReady ? "connected" : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

router.use("/auth", authRoutes);
router.use("/products", catalogRoutes);
router.use("/cms", cmsRoutes);
router.use("/bag", bagRoutes);
router.use("/checkout", checkoutRoutes);
router.use("/coupons", couponRoutes);
router.use("/reviews", reviewRoutes);
router.use("/policies", policyRoutes);
router.use("/crm", crmRoutes);
router.use("/media", mediaRoutes);
router.use("/analytics", analyticsRoutes);
router.use("/activity", activityRoutes);
router.use("/admin", adminRoutes);

export default router;