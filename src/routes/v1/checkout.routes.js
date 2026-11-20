import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  startCheckout,
  listMyOrders,
  getOrderByNumber,
} from "../../controllers/checkout.controller.js";

const router = Router();

const checkoutSchema = z.object({
  couponCode: z.string().trim().min(2).max(40).nullable().optional(),
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

router.use(requireAuth);

router.post("/session", validate(checkoutSchema), startCheckout);
router.get("/orders", listMyOrders);
router.get("/orders/:orderNumber", getOrderByNumber);

export default router;