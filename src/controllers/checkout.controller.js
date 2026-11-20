import { Order } from "../models/Order.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  createCheckoutSession,
  processRazorpayWebhook,
} from "../services/checkout.service.js";
import { ApiError } from "../utils/apiError.js";

export async function startCheckout(req, res) {
  const data = await createCheckoutSession(req, {
    shippingAddress: req.body.shippingAddress,
    couponCode: req.body.couponCode || null,
  });
  return sendSuccess(res, { statusCode: 201, data });
}

export async function handleRazorpayWebhook(req, res) {
  const signature = req.get("x-razorpay-signature");
  const eventId = req.get("x-razorpay-event-id");
  const result = await processRazorpayWebhook({
    rawBody: req.body,
    signature,
    eventId,
  });

  return res.status(200).json({ received: true, ...result });
}

export async function listMyOrders(req, res) {
  const orders = await Order.find({ userId: req.user._id })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();

  return sendSuccess(res, { data: { orders } });
}

export async function getOrderByNumber(req, res) {
  const order = await Order.findOne({
    orderNumber: req.params.orderNumber,
    userId: req.user._id,
  }).lean();

  if (!order) {
    throw ApiError.notFound("Order not found");
  }

  return sendSuccess(res, { data: { order } });
}