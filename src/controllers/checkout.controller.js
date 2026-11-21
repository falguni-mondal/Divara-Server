import { Order } from "../models/Order.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  preflightCheckoutStock,
  releaseAbandonedCheckout,
  createCheckoutSession,
  verifyRazorpayPayment,
  recordClientPaymentFailure,
  cancelCustomerOrder,
  requestCustomerReturn,
  processRazorpayWebhook,
} from "../services/checkout.service.js";
import { ApiError } from "../utils/apiError.js";

export async function preflightCheckout(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const data = await preflightCheckoutStock(req, {
    couponCode: req.body?.couponCode || null,
  });
  return sendSuccess(res, { data });
}

export async function releaseCheckoutHold(req, res) {
  const data = await releaseAbandonedCheckout(req, {
    orderId: req.body?.orderId || null,
    razorpayOrderId: req.body?.razorpayOrderId || null,
  });
  return sendSuccess(res, { data });
}

export async function startCheckout(req, res) {
  const data = await createCheckoutSession(req, {
    shippingAddress: req.body.shippingAddress,
    couponCode: req.body.couponCode || null,
    attribution: req.body.attribution || null,
  });
  return sendSuccess(res, { statusCode: 201, data });
}

export async function verifyCheckoutPayment(req, res) {
  const data = await verifyRazorpayPayment(req, {
    razorpayOrderId: req.body.razorpayOrderId,
    razorpayPaymentId: req.body.razorpayPaymentId,
    razorpaySignature: req.body.razorpaySignature,
  });
  return sendSuccess(res, { message: "Payment verified and order confirmed.", data });
}

export async function reportCheckoutFailure(req, res) {
  const data = await recordClientPaymentFailure(req, {
    razorpayOrderId: req.body.razorpayOrderId,
    razorpayPaymentId: req.body.razorpayPaymentId || null,
    reason: req.body.reason,
    code: req.body.code,
  });
  return sendSuccess(res, { data });
}

export async function cancelMyOrder(req, res) {
  const order = await cancelCustomerOrder(
    req,
    req.params.orderNumber,
    req.body.reason || "Cancelled by customer"
  );
  return sendSuccess(res, {
    message: "Order cancelled and inventory restocked.",
    data: { order },
  });
}

export async function requestMyOrderReturn(req, res) {
  const order = await requestCustomerReturn(req, req.params.orderNumber, req.body.reason);
  return sendSuccess(res, {
    message: "Return request submitted for Atelier review.",
    data: { order },
  });
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

  if (!order) throw ApiError.notFound("Order not found");
  return sendSuccess(res, { data: { order } });
}