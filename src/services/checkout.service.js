import crypto from "crypto";
import mongoose from "mongoose";
import Razorpay from "razorpay";
import { env } from "../config/env.js";
import { Bag } from "../models/Bag.js";
import { Product } from "../models/Product.js";
import { Reservation } from "../models/Reservation.js";
import { Order } from "../models/Order.js";
import { Coupon } from "../models/Coupon.js";
import { CouponRedemption } from "../models/CouponRedemption.js";
import { WebhookEvent } from "../models/WebhookEvent.js";
import { Job } from "../models/Job.js";
import { resolveCheckoutCoupon } from "./coupon.service.js";
import { appCache } from "../utils/lruCache.js";
import { ApiError } from "../utils/apiError.js";

const RESERVATION_TTL_MS = 15 * 60 * 1000;
const GST_RATE = 0.12;

function getRazorpayClient() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) return null;
  return new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
}

function generateOrderNumber() {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randPart = crypto.randomBytes(3).toString("hex").toUpperCase();
  return `DIV-${datePart}-${randPart}`;
}

export async function createCheckoutSession(
  req,
  { shippingAddress, couponCode = null, attribution = null }
) {
  const userId = req.user._id;
  const bag = await Bag.findOne({ userId }).lean();

  if (!bag || bag.items.length === 0) {
    throw ApiError.badRequest("Your shopping bag is empty");
  }

  const activeHolds = await Reservation.countDocuments({
    userId,
    status: "HELD",
    expiresAt: { $gt: new Date() },
  });
  if (activeHolds >= 2) {
    throw ApiError.conflict(
      "You already have an active checkout session. Please complete or wait for it to expire."
    );
  }

  const appliedCoupon = await resolveCheckoutCoupon({
    user: req.user,
    bagItems: bag.items,
    couponCode,
  });

  const session = await mongoose.startSession();
  let createdOrder = null;

  try {
    await session.withTransaction(async () => {
      const orderItems = [];
      const reservedItems = [];
      let subtotalPaise = 0;

      for (const item of bag.items) {
        const updatedProduct = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            isActive: true,
            variants: {
              $elemMatch: {
                size: item.size,
                $expr: {
                  $gte: [{ $subtract: ["$stockOnHand", "$stockReserved"] }, item.quantity],
                },
              },
            },
          },
          { $inc: { "variants.$.stockReserved": item.quantity } },
          { session, returnDocument: "after" }
        );

        if (!updatedProduct) {
          throw ApiError.conflict(`"${item.title}" (${item.size}) no longer has sufficient stock`);
        }

        const matchedVariant = updatedProduct.variants.find((v) => v.size === item.size);
        subtotalPaise += updatedProduct.pricePaise * item.quantity;

        orderItems.push({
          productId: updatedProduct._id,
          slug: updatedProduct.slug,
          title: updatedProduct.title,
          category: updatedProduct.categoryLabel,
          size: item.size,
          sku: matchedVariant.sku,
          quantity: item.quantity,
          unitPrice: updatedProduct.price,
          unitPricePaise: updatedProduct.pricePaise,
          image: updatedProduct.imageMedia?.url || item.image,
        });

        reservedItems.push({
          productId: updatedProduct._id,
          slug: updatedProduct.slug,
          size: item.size,
          quantity: item.quantity,
        });
      }

      let discountPaise = 0;
      let couponId = null;
      let usedCouponCode = null;

      if (appliedCoupon?.valid) {
        const couponFilter = {
          _id: appliedCoupon.coupon._id,
          isActive: true,
          ...(appliedCoupon.coupon.maxTotalUses !== null
            ? { usedCount: { $lt: appliedCoupon.coupon.maxTotalUses } }
            : {}),
        };

        const claimed = await Coupon.findOneAndUpdate(
          couponFilter,
          { $inc: { usedCount: 1 } },
          { session, returnDocument: "after" }
        );

        if (!claimed) {
          throw ApiError.conflict("This coupon just reached its maximum usage limit.");
        }

        discountPaise = Math.min(subtotalPaise, appliedCoupon.discountPaise);
        couponId = claimed._id;
        usedCouponCode = claimed.code;
      }

      const taxablePaise = Math.max(0, subtotalPaise - discountPaise);
      const gstPaise = Math.round(taxablePaise * GST_RATE);
      const totalPaise = taxablePaise + gstPaise;
      const orderNumber = generateOrderNumber();

      const [orderDoc] = await Order.create(
        [
          {
            orderNumber,
            userId,
            customerEmail: shippingAddress.email || req.user.email,
            items: orderItems,
            shippingAddress,
            attribution: attribution
              ? {
                  utmSource: attribution.utmSource || "direct",
                  utmMedium: attribution.utmMedium || "none",
                  utmCampaign: attribution.utmCampaign || "",
                  utmContent: attribution.utmContent || "",
                  referralPerson: attribution.referralPerson || "",
                  landingPath: attribution.landingPath || "/",
                }
              : {},
            couponId,
            couponCode: usedCouponCode,
            subtotalPaise,
            discountPaise,
            gstPaise,
            shippingPaise: 0,
            totalPaise,
            currency: "INR",
            status: "PENDING_PAYMENT",
          },
        ],
        { session }
      );

      if (couponId) {
        await CouponRedemption.create(
          [
            {
              couponId,
              couponCode: usedCouponCode,
              userId,
              orderId: orderDoc._id,
              discountPaise,
              status: "RESERVED",
            },
          ],
          { session }
        );
      }

      await Reservation.create(
        [
          {
            checkoutToken: crypto.randomUUID(),
            orderId: orderDoc._id,
            userId,
            items: reservedItems,
            status: "HELD",
            expiresAt: new Date(Date.now() + RESERVATION_TTL_MS),
          },
        ],
        { session }
      );

      createdOrder = orderDoc;
    });
  } finally {
    await session.endSession();
  }

  appCache.invalidatePrefix("catalog:");

  const rzp = getRazorpayClient();
  let razorpayOrderId = `order_dev_${createdOrder.orderNumber}`;

  if (rzp) {
    const rzpOrder = await rzp.orders.create({
      amount: createdOrder.totalPaise,
      currency: "INR",
      receipt: createdOrder.orderNumber,
      notes: { orderId: String(createdOrder._id) },
    });
    razorpayOrderId = rzpOrder.id;
  }

  createdOrder.razorpayOrderId = razorpayOrderId;
  await createdOrder.save();

  return {
    orderId: String(createdOrder._id),
    orderNumber: createdOrder.orderNumber,
    razorpayOrderId,
    razorpayKeyId: env.RAZORPAY_KEY_ID || null,
    couponCode: createdOrder.couponCode,
    discountInr: Math.round(createdOrder.discountPaise / 100),
    amountPaise: createdOrder.totalPaise,
    currency: "INR",
    expiresInSeconds: RESERVATION_TTL_MS / 1000,
  };
}

export async function processRazorpayWebhook({ rawBody, signature, eventId }) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw ApiError.badRequest("Razorpay webhook secret is not configured");
  }

  const expectedSig = crypto
    .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");

  const sigBuf = Buffer.from(signature || "", "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw ApiError.unauthorized("Invalid X-Razorpay-Signature");
  }

  const payload = JSON.parse(rawBody.toString("utf8"));
  const eventType = payload.event;
  const paymentEntity = payload?.payload?.payment?.entity;
  const rzpOrderId = paymentEntity?.order_id || payload?.payload?.order?.entity?.id;
  const rzpPaymentId = paymentEntity?.id || null;
  const dedupeId = eventId || `${eventType}:${rzpPaymentId || Date.now()}`;

  try {
    await WebhookEvent.create({ eventId: dedupeId, eventType });
  } catch (err) {
    if (err.code === 11000) return { duplicate: true };
    throw err;
  }

  if (eventType === "payment.failed") {
    const failedOrder = await Order.findOne({ razorpayOrderId: rzpOrderId }).lean();
    if (failedOrder && failedOrder.status === "PENDING_PAYMENT") {
      await Job.create({
        type: "SEND_ADMIN_ORDER_FAILURE",
        idempotencyKey: `admin-fail-${failedOrder.orderNumber}-${rzpPaymentId || Date.now()}`,
        payload: {
          orderNumber: failedOrder.orderNumber,
          email: failedOrder.customerEmail,
          fullName: failedOrder.shippingAddress?.fullName,
          shippingAddress: failedOrder.shippingAddress,
          items: failedOrder.items,
          couponCode: failedOrder.couponCode,
          totalInr: Math.round(failedOrder.totalPaise / 100),
          razorpayOrderId: rzpOrderId,
          razorpayPaymentId: rzpPaymentId,
          failureReason:
            paymentEntity?.error_description || paymentEntity?.error_reason || "Payment declined",
          errorCode: paymentEntity?.error_code || "PAYMENT_FAILED",
          paymentMethod: paymentEntity?.method || "Unknown",
          failedAt: new Date(),
        },
      });
    }
    return { recordedFailure: true, eventType };
  }

  if (eventType !== "payment.captured" && eventType !== "order.paid") {
    return { ignored: true, eventType };
  }

  const order = await Order.findOne({ razorpayOrderId: rzpOrderId });
  if (!order || order.status === "PAID") return { alreadyProcessed: true };

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const reservation = await Reservation.findOne({ orderId: order._id }).session(session);

      if (reservation && reservation.status === "HELD") {
        for (const item of reservation.items) {
          await Product.updateOne(
            { _id: item.productId, "variants.size": item.size },
            {
              $inc: {
                "variants.$.stockOnHand": -item.quantity,
                "variants.$.stockReserved": -item.quantity,
              },
            },
            { session }
          );
        }
        reservation.status = "COMMITTED";
        await reservation.save({ session });
        order.status = "PAID";
      } else {
        let allDeducted = true;
        for (const item of order.items) {
          const updated = await Product.findOneAndUpdate(
            {
              _id: item.productId,
              variants: { $elemMatch: { size: item.size, stockOnHand: { $gte: item.quantity } } },
            },
            { $inc: { "variants.$.stockOnHand": -item.quantity } },
            { session, returnDocument: "after" }
          );
          if (!updated) allDeducted = false;
        }
        order.status = allDeducted ? "PAID" : "CONCIERGE_REVIEW";
      }

      if (order.couponId) {
        await CouponRedemption.updateOne(
          { orderId: order._id, status: "RESERVED" },
          { $set: { status: "REDEEMED" } },
          { session }
        );
      }

      order.razorpayPaymentId = rzpPaymentId;
      order.paidAt = new Date();
      await order.save({ session });

      await Bag.updateOne({ userId: order.userId }, { $set: { items: [] } }, { session });

      const mailPayload = {
        orderNumber: order.orderNumber,
        email: order.customerEmail,
        fullName: order.shippingAddress.fullName,
        shippingAddress: order.shippingAddress,
        items: order.items,
        couponCode: order.couponCode,
        subtotalInr: Math.round(order.subtotalPaise / 100),
        discountInr: Math.round((order.discountPaise || 0) / 100),
        gstInr: Math.round(order.gstPaise / 100),
        totalInr: Math.round(order.totalPaise / 100),
        razorpayOrderId: order.razorpayOrderId,
        razorpayPaymentId: order.razorpayPaymentId,
        paidAt: order.paidAt,
      };

      await Job.create(
        [
          {
            type: order.status === "PAID" ? "SEND_ORDER_CONFIRMATION" : "SEND_CONCIERGE_ALERT",
            idempotencyKey: `order-user-mail-${order.orderNumber}`,
            payload: mailPayload,
          },
          {
            type: "SEND_ADMIN_ORDER_SUCCESS",
            idempotencyKey: `order-admin-mail-${order.orderNumber}`,
            payload: mailPayload,
          },
        ],
        { session }
      );
    });
  } finally {
    await session.endSession();
  }

  appCache.invalidatePrefix("catalog:");
  return { processed: true, orderNumber: order.orderNumber };
}