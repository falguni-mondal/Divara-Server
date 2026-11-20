import { Router } from "express";
import { z } from "zod";
import { requireAuth, blockAdminShopping } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  startCheckout,
  verifyCheckoutPayment,
  reportCheckoutFailure,
  cancelMyOrder,
  requestMyOrderReturn,
  listMyOrders,
  getOrderByNumber,
} from "../../controllers/checkout.controller.js";

const router = Router();

const checkoutSchema = z.object({
  couponCode: z.string().trim().min(2).max(40).nullable().optional(),
  attribution: z
    .object({
      utmSource: z.string().trim().max(80).optional().default("direct"),
      utmMedium: z.string().trim().max(80).optional().default("none"),
      utmCampaign: z.string().trim().max(120).optional().default(""),
      utmContent: z.string().trim().max(120).optional().default(""),
      referralPerson: z.string().trim().max(100).optional().default(""),
      landingPath: z.string().trim().max(300).optional().default("/"),
    })
    .nullable()
    .optional(),
  shippingAddress: z.object({
    fullName: z.string().trim().min(2).max(120),
    email: z.string().email(),
    phone: z.string().trim().min(10).max(20),
    line1: z.string().trim().min(4).max(200),
    line2: z.string().trim().max(200).optional().default(""),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().min(2).max(80),
    postalCode: z.string().trim().min(5).max(12),
    country: z.string().trim().default("India"),
  }),
});

const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(5),
  razorpayPaymentId: z.string().min(5),
  razorpaySignature: z.string().min(10),
});

const reportFailureSchema = z.object({
  razorpayOrderId: z.string().min(5),
  razorpayPaymentId: z.string().nullable().optional(),
  reason: z.string().max(300).optional(),
  code: z.string().max(80).optional(),
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().max(300).optional().default("Cancelled by customer"),
});

const returnRequestSchema = z.object({
  reason: z.string().trim().min(5, "Please describe the reason for return").max(500),
});

router.use(requireAuth, blockAdminShopping);

router.post("/session", validate(checkoutSchema), startCheckout);
router.post("/verify", validate(verifyPaymentSchema), verifyCheckoutPayment);
router.post("/failure", validate(reportFailureSchema), reportCheckoutFailure);
router.get("/orders", listMyOrders);
router.get("/orders/:orderNumber", getOrderByNumber);
router.post("/orders/:orderNumber/cancel", validate(cancelOrderSchema), cancelMyOrder);
router.post("/orders/:orderNumber/return", validate(returnRequestSchema), requestMyOrderReturn);

export default router;