import { Order } from "../models/Order.js";
import { Product } from "../models/Product.js";
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
import { recordServerEvent } from "../services/activity.service.js";

function paiseToInr(val) {
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? Math.round(n / 100) : 0;
}

async function mapItemsWithSkus(items = []) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const ids = items.map((i) => i.productId).filter(Boolean);
  const prods = await Product.find({ _id: { $in: ids } })
    .select("_id slug title imageMedia variants price")
    .lean();
  const prodMap = new Map(prods.map((p) => [String(p._id), p]));

  return items.map((it) => {
    const prod = prodMap.get(String(it.productId));
    const variant = prod?.variants?.find((v) => v.size === it.size) || prod?.variants?.[0];
    const unitPriceInr =
      typeof it.unitPricePaise === "number"
        ? paiseToInr(it.unitPricePaise)
        : Number(it.price ?? prod?.price) || 0;

    return {
      productId: it.productId || prod?._id || null,
      slug: it.slug || prod?.slug || "",
      title: it.title || prod?.title || "",
      sku: it.sku || variant?.sku || "",
      primaryImage: it.image || it.primaryImage || prod?.imageMedia?.url || "",
      size: it.size || "",
      quantity: Number(it.quantity) || 1,
      price: unitPriceInr,
    };
  });
}

export async function preflightCheckout(req, res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  const data = await preflightCheckoutStock(req, {
    couponCode: req.body?.couponCode || null,
  });

  const hasIssues = Array.isArray(data?.stockIssues) && data.stockIssues.length > 0;
  const cartItems = await mapItemsWithSkus(data?.items || []);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: hasIssues ? "WARNING" : "INFO",
    actionName: "CHECKOUT_PREFLIGHT",
    pageName: "Checkout",
    path: "/checkout",
    cartItems,
    cartTotal: Number(data?.subtotal) || paiseToInr(data?.totalPaise),
    meta: {
      couponCode: req.body?.couponCode || null,
      stockIssuesCount: hasIssues ? data.stockIssues.length : 0,
    },
  });

  return sendSuccess(res, { data });
}

export async function releaseCheckoutHold(req, res) {
  const data = await releaseAbandonedCheckout(req, {
    orderId: req.body?.orderId || null,
    razorpayOrderId: req.body?.razorpayOrderId || null,
  });

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: "WARNING",
    actionName: "CHECKOUT_ABANDONED_HOLD_RELEASED",
    pageName: "Checkout",
    path: "/checkout",
    meta: {
      orderId: req.body?.orderId || null,
      razorpayOrderId: req.body?.razorpayOrderId || null,
    },
  });

  return sendSuccess(res, { data });
}

export async function startCheckout(req, res) {
  const data = await createCheckoutSession(req, {
    shippingAddress: req.body.shippingAddress,
    couponCode: req.body.couponCode || null,
    attribution: req.body.attribution || null,
  });

  const orderDoc = data?.orderId
    ? await Order.findById(data.orderId).select("orderNumber items totalPaise").lean()
    : null;
  const cartItems = await mapItemsWithSkus(orderDoc?.items || []);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: "INFO",
    actionName: "CHECKOUT_STARTED",
    pageName: "Checkout",
    path: "/checkout",
    cartItems,
    cartTotal: paiseToInr(orderDoc?.totalPaise ?? data?.amountPaise ?? data?.amount),
    meta: {
      orderNumber: orderDoc?.orderNumber || data?.orderNumber || "",
      couponCode: req.body.couponCode || null,
      city: req.body.shippingAddress?.city || "",
    },
  });

  return sendSuccess(res, { statusCode: 201, data });
}

export async function verifyCheckoutPayment(req, res) {
  const data = await verifyRazorpayPayment(req, {
    razorpayOrderId: req.body.razorpayOrderId,
    razorpayPaymentId: req.body.razorpayPaymentId,
    razorpaySignature: req.body.razorpaySignature,
  });

  const orderObj = data?.order || null;
  const cartItems = await mapItemsWithSkus(orderObj?.items || []);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: "SUCCESS",
    actionName: "CHECKOUT_PAYMENT_SUCCESS",
    pageName: "Checkout",
    path: "/checkout",
    cartItems,
    cartTotal: paiseToInr(orderObj?.totalPaise),
    meta: {
      orderNumber: orderObj?.orderNumber || "",
      razorpayOrderId: req.body.razorpayOrderId,
      razorpayPaymentId: req.body.razorpayPaymentId,
    },
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

  const orderDoc = req.body.razorpayOrderId
    ? await Order.findOne({ razorpayOrderId: req.body.razorpayOrderId })
        .select("orderNumber items totalPaise")
        .lean()
    : null;
  const cartItems = await mapItemsWithSkus(orderDoc?.items || []);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: "FAILED",
    actionName: "CHECKOUT_PAYMENT_FAILED",
    pageName: "Checkout",
    path: "/checkout",
    cartItems,
    cartTotal: paiseToInr(orderDoc?.totalPaise),
    meta: {
      orderNumber: orderDoc?.orderNumber || "",
      razorpayOrderId: req.body.razorpayOrderId || "",
      reason: req.body.reason || "Payment failed or cancelled",
      code: req.body.code || "",
    },
  });

  return sendSuccess(res, { data });
}

export async function cancelMyOrder(req, res) {
  const order = await cancelCustomerOrder(
    req,
    req.params.orderNumber,
    req.body.reason || "Cancelled by customer"
  );

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: "WARNING",
    actionName: "ORDER_CANCELLED_BY_CUSTOMER",
    pageName: "Account Orders",
    path: "/account",
    cartTotal: paiseToInr(order?.totalPaise),
    meta: {
      orderNumber: req.params.orderNumber,
      reason: req.body.reason || "Cancelled by customer",
    },
  });

  return sendSuccess(res, {
    message: "Order cancelled and inventory restocked.",
    data: { order },
  });
}

export async function requestMyOrderReturn(req, res) {
  const order = await requestCustomerReturn(req, req.params.orderNumber, req.body.reason);

  await recordServerEvent({
    req,
    userId: req.user._id,
    type: "CHECKOUT",
    status: "WARNING",
    actionName: "ORDER_RETURN_REQUESTED",
    pageName: "Account Orders",
    path: "/account",
    cartTotal: paiseToInr(order?.totalPaise),
    meta: {
      orderNumber: req.params.orderNumber,
      reason: req.body.reason || "",
    },
  });

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