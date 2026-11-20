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
const RETURN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const GST_RATE = 0.12;
const activeRefundLocks = new Set();

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

export async function restoreOrderStockInSession(orderDoc, session) {
  if (!orderDoc || orderDoc.stockRestored) return false;

  const reservation = await Reservation.findOne({ orderId: orderDoc._id }).session(session);

  if (reservation && reservation.status === "HELD") {
    for (const item of reservation.items) {
      await Product.updateOne(
        {
          _id: item.productId,
          variants: { $elemMatch: { size: item.size, stockReserved: { $gte: item.quantity } } },
        },
        { $inc: { "variants.$.stockReserved": -item.quantity } },
        { session }
      );
    }
    reservation.status = "RELEASED";
    await reservation.save({ session });
  } else if (
    orderDoc.paidAt ||
    ["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "RETURN_REQUESTED", "RETURN_APPROVED"].includes(
      orderDoc.status
    )
  ) {
    for (const item of orderDoc.items) {
      await Product.updateOne(
        { _id: item.productId, "variants.size": item.size },
        { $inc: { "variants.$.stockOnHand": item.quantity } },
        { session }
      );
    }
  }

  if (orderDoc.couponId) {
    const redemption = await CouponRedemption.findOne({
      orderId: orderDoc._id,
      status: { $in: ["RESERVED", "REDEEMED"] },
    }).session(session);

    if (redemption) {
      redemption.status = "RELEASED";
      await redemption.save({ session });
      await Coupon.updateOne(
        { _id: orderDoc.couponId, usedCount: { $gt: 0 } },
        { $inc: { usedCount: -1 } },
        { session }
      );
    }
  }

  orderDoc.stockRestored = true;
  return true;
}

async function finalizePaidOrder(order, rzpPaymentId) {
  if (!order) return { notFound: true };
  if (["PAID", "PROCESSING", "SHIPPED", "DELIVERED", "CONCIERGE_REVIEW"].includes(order.status)) {
    return { alreadyProcessed: true, orderNumber: order.orderNumber, status: order.status };
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const freshOrder = await Order.findById(order._id).session(session);
      if (!freshOrder) return;

      // Allow processing PENDING_PAYMENT OR a recently auto-cancelled unpaid order (late Razorpay capture)
      const isProcessable =
        freshOrder.status === "PENDING_PAYMENT" ||
        (freshOrder.status === "CANCELLED" && !freshOrder.paidAt);
      if (!isProcessable) return;

      const reservation = await Reservation.findOne({ orderId: freshOrder._id }).session(session);

      if (reservation && reservation.status === "HELD") {
        for (const item of reservation.items) {
          await Product.updateOne(
            {
              _id: item.productId,
              variants: { $elemMatch: { size: item.size, stockReserved: { $gte: item.quantity } } },
            },
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
        freshOrder.status = "PAID";
        freshOrder.stockRestored = false;
      } else {
        // Hold expired & was released before payment settled — attempt atomic deduction or route to Concierge
        let allDeducted = true;
        for (const item of freshOrder.items) {
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
        freshOrder.status = allDeducted ? "PAID" : "CONCIERGE_REVIEW";
        freshOrder.stockRestored = !allDeducted;
      }

      if (freshOrder.couponId) {
        await CouponRedemption.updateOne(
          { orderId: freshOrder._id, status: "RESERVED" },
          { $set: { status: "REDEEMED" } },
          { session }
        );
      }

      freshOrder.razorpayPaymentId = rzpPaymentId;
      freshOrder.paidAt = new Date();
      await freshOrder.save({ session });

      await Bag.updateOne({ userId: freshOrder.userId }, { $set: { items: [] } }, { session });

      const mailPayload = {
        orderNumber: freshOrder.orderNumber,
        email: freshOrder.customerEmail,
        fullName: freshOrder.shippingAddress.fullName,
        shippingAddress: freshOrder.shippingAddress,
        items: freshOrder.items,
        couponCode: freshOrder.couponCode,
        subtotalInr: Math.round(freshOrder.subtotalPaise / 100),
        discountInr: Math.round((freshOrder.discountPaise || 0) / 100),
        gstInr: Math.round(freshOrder.gstPaise / 100),
        totalInr: Math.round(freshOrder.totalPaise / 100),
        razorpayOrderId: freshOrder.razorpayOrderId,
        razorpayPaymentId: freshOrder.razorpayPaymentId,
        paidAt: freshOrder.paidAt,
      };

      const existingJob = await Job.exists({
        idempotencyKey: `order-user-mail-${freshOrder.orderNumber}`,
      }).session(session);

      if (!existingJob) {
        await Job.create(
          [
            {
              type: freshOrder.status === "PAID" ? "SEND_ORDER_CONFIRMATION" : "SEND_CONCIERGE_ALERT",
              idempotencyKey: `order-user-mail-${freshOrder.orderNumber}`,
              payload: mailPayload,
            },
            {
              type: "SEND_ADMIN_ORDER_SUCCESS",
              idempotencyKey: `order-admin-mail-${freshOrder.orderNumber}`,
              payload: mailPayload,
            },
          ],
          { session, ordered: true }
        );
      }
    });
  } finally {
    await session.endSession();
  }

  appCache.invalidatePrefix("catalog:");
  return { processed: true, orderNumber: order.orderNumber };
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
      const lockedLines = [];
      let subtotalPaise = 0;

      for (const item of bag.items) {
        const prodDoc = await Product.findOne({
          _id: item.productId,
          isActive: true,
        }).session(session);

        const currentVariant = prodDoc?.variants?.find((v) => v.size === item.size);
        const available = currentVariant
          ? (currentVariant.stockOnHand || 0) - (currentVariant.stockReserved || 0)
          : 0;

        if (!prodDoc || !currentVariant || available < item.quantity) {
          throw ApiError.conflict(`"${item.title}" (${item.size}) no longer has sufficient stock`);
        }

        const updatedProduct = await Product.findOneAndUpdate(
          {
            _id: item.productId,
            isActive: true,
            variants: {
              $elemMatch: {
                size: item.size,
                stockReserved: currentVariant.stockReserved,
                stockOnHand: { $gte: currentVariant.stockReserved + item.quantity },
              },
            },
          },
          { $inc: { "variants.$.stockReserved": item.quantity } },
          { session, returnDocument: "after" }
        );

        if (!updatedProduct) {
          throw ApiError.conflict(
            `"${item.title}" (${item.size}) stock changed during checkout. Please try again.`
          );
        }

        const matchedVariant = updatedProduct.variants.find((v) => v.size === item.size);
        const linePaise = updatedProduct.pricePaise * item.quantity;
        subtotalPaise += linePaise;

        lockedLines.push({
          productId: updatedProduct._id,
          category: updatedProduct.category,
          season: updatedProduct.season,
          linePaise,
        });

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
        const cpn = appliedCoupon.coupon;

        if (cpn.maxUsesPerUser) {
          const userUses = await CouponRedemption.countDocuments({
            couponId: cpn._id,
            userId,
            status: { $in: ["RESERVED", "REDEEMED"] },
          }).session(session);
          if (userUses >= cpn.maxUsesPerUser) {
            throw ApiError.conflict("You have already reached the usage limit for this coupon.");
          }
        }

        if (cpn.firstOrderOnly) {
          const hasPriorOrder = await Order.exists({
            userId,
            status: { $in: ["PAID", "PROCESSING", "SHIPPED", "DELIVERED"] },
          }).session(session);
          if (hasPriorOrder) {
            throw ApiError.conflict("This coupon is valid on your first order only.");
          }
        }

        const couponFilter = {
          _id: cpn._id,
          isActive: true,
          ...(cpn.maxTotalUses !== null ? { usedCount: { $lt: cpn.maxTotalUses } } : {}),
        };

        const claimed = await Coupon.findOneAndUpdate(
          couponFilter,
          { $inc: { usedCount: 1 } },
          { session, returnDocument: "after" }
        );

        if (!claimed) {
          throw ApiError.conflict("This coupon just reached its maximum usage limit.");
        }

        // Compute eligible subtotal from locked transaction prices (matches coupon.service.js exactly)
        let eligibleSubtotalPaise = 0;
        for (const line of lockedLines) {
          let eligible = false;
          if (claimed.applicableTo === "ALL") {
            eligible = true;
          } else if (claimed.applicableTo === "SPECIFIC_PRODUCTS") {
            eligible = (claimed.productIds || []).some(
              (id) => String(id) === String(line.productId)
            );
          } else if (claimed.applicableTo === "SPECIFIC_CATEGORIES") {
            eligible = (claimed.categories || []).includes(line.category);
          } else if (claimed.applicableTo === "SPECIFIC_SEASONS") {
            eligible = (claimed.seasons || []).includes(line.season);
          }
          if (eligible) eligibleSubtotalPaise += line.linePaise;
        }

        let computedDiscountInr = 0;
        const eligibleSubtotalInr = eligibleSubtotalPaise / 100;
        if (claimed.discountType === "PERCENTAGE") {
          computedDiscountInr = Math.round((eligibleSubtotalInr * claimed.discountValue) / 100);
          if (claimed.maxDiscountInr && computedDiscountInr > claimed.maxDiscountInr) {
            computedDiscountInr = claimed.maxDiscountInr;
          }
        } else {
          computedDiscountInr = Math.min(eligibleSubtotalInr, claimed.discountValue);
        }

        discountPaise = Math.min(subtotalPaise, Math.round(computedDiscountInr * 100));
        couponId = claimed._id;
        usedCouponCode = claimed.code;
      }

      // Product prices are FINAL MRP (inclusive of 12% GST).
      // Intra-state (West Bengal) -> CGST 6% + SGST 6%; Inter-state -> IGST 12%.
      const totalPaise = Math.max(0, subtotalPaise - discountPaise);
      if (totalPaise < 100) {
        throw ApiError.badRequest("Minimum payable order amount is ₹1.");
      }

      const taxableBasePaise = Math.round(totalPaise / (1 + GST_RATE));
      const gstPaise = totalPaise - taxableBasePaise;
      const isIntraState =
        String(shippingAddress.state || "").trim().toLowerCase() === "west bengal";
      const taxType = isIntraState ? "CGST_SGST" : "IGST";
      const cgstPaise = isIntraState ? Math.floor(gstPaise / 2) : 0;
      const sgstPaise = isIntraState ? gstPaise - cgstPaise : 0;
      const igstPaise = isIntraState ? 0 : gstPaise;
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
            taxableBasePaise,
            gstRatePercent: 12,
            taxType,
            cgstPaise,
            sgstPaise,
            igstPaise,
            gstPaise,
            hsnCode: "6204",
            shippingPaise: 0,
            totalPaise,
            currency: "INR",
            status: "PENDING_PAYMENT",
          },
        ],
        { session, ordered: true }
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
          { session, ordered: true }
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
        { session, ordered: true }
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
    try {
      const rzpOrder = await rzp.orders.create({
        amount: createdOrder.totalPaise,
        currency: "INR",
        receipt: createdOrder.orderNumber,
        notes: { orderId: String(createdOrder._id) },
      });
      razorpayOrderId = rzpOrder.id;
    } catch (err) {
      const rollbackSession = await mongoose.startSession();
      try {
        await rollbackSession.withTransaction(async () => {
          const fresh = await Order.findById(createdOrder._id).session(rollbackSession);
          if (fresh && fresh.status === "PENDING_PAYMENT") {
            await restoreOrderStockInSession(fresh, rollbackSession);
            fresh.status = "CANCELLED";
            fresh.cancelledAt = new Date();
            fresh.cancelReason = "Payment gateway initialization failed";
            await fresh.save({ session: rollbackSession });
          }
        });
      } finally {
        await rollbackSession.endSession();
      }
      appCache.invalidatePrefix("catalog:");
      throw ApiError.badRequest(
        `Unable to initialize payment gateway: ${err?.error?.description || err.message || "Please try again."}`
      );
    }
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

export async function verifyRazorpayPayment(
  req,
  { razorpayOrderId, razorpayPaymentId, razorpaySignature }
) {
  if (!env.RAZORPAY_KEY_SECRET) {
    throw ApiError.badRequest("Razorpay key secret is not configured on the server.");
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");

  const sigBuf = Buffer.from(razorpaySignature || "", "utf8");
  const expBuf = Buffer.from(expectedSignature, "utf8");

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw ApiError.unauthorized("Invalid Razorpay payment signature.");
  }

  const order = await Order.findOne({ razorpayOrderId, userId: req.user._id });
  if (!order) throw ApiError.notFound("Matching order not found for your account.");

  return finalizePaidOrder(order, razorpayPaymentId);
}

export async function recordClientPaymentFailure(
  req,
  { razorpayOrderId, razorpayPaymentId = null, reason = "Payment failed", code = "PAYMENT_FAILED" }
) {
  const failedOrder = await Order.findOne({
    razorpayOrderId,
    userId: req.user._id,
  }).lean();

  if (!failedOrder || failedOrder.status !== "PENDING_PAYMENT") {
    return { ignored: true };
  }

  const key = `admin-fail-${failedOrder.orderNumber}-${razorpayPaymentId || "client"}`;
  const alreadyQueued = await Job.exists({ idempotencyKey: key });
  if (!alreadyQueued) {
    await Job.create({
      type: "SEND_ADMIN_ORDER_FAILURE",
      idempotencyKey: key,
      payload: {
        orderNumber: failedOrder.orderNumber,
        email: failedOrder.customerEmail,
        fullName: failedOrder.shippingAddress?.fullName,
        shippingAddress: failedOrder.shippingAddress,
        items: failedOrder.items,
        couponCode: failedOrder.couponCode,
        totalInr: Math.round(failedOrder.totalPaise / 100),
        razorpayOrderId,
        razorpayPaymentId,
        failureReason: reason,
        errorCode: code,
        paymentMethod: "Razorpay Checkout",
        failedAt: new Date(),
      },
    });
  }

  return { recordedFailure: true, orderNumber: failedOrder.orderNumber };
}

export async function cancelCustomerOrder(req, orderNumber, reason = "Cancelled by customer") {
  const order = await Order.findOne({ orderNumber, userId: req.user._id });
  if (!order) throw ApiError.notFound("Order not found");

  if (!["PENDING_PAYMENT", "PAID", "PROCESSING"].includes(order.status)) {
    throw ApiError.badRequest(
      `Order cannot be cancelled once it is ${order.status}. Please request a return after delivery.`
    );
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const fresh = await Order.findById(order._id).session(session);
      const wasPaid = Boolean(fresh.paidAt || fresh.razorpayPaymentId);

      await restoreOrderStockInSession(fresh, session);
      fresh.status = "CANCELLED";
      fresh.cancelledAt = new Date();
      fresh.cancelReason = reason;
      await fresh.save({ session });

      const jobsToQueue = [
        {
          type: "SEND_ORDER_STATUS_UPDATE",
          idempotencyKey: `order-cancel-${fresh.orderNumber}-${Date.now()}`,
          payload: {
            orderNumber: fresh.orderNumber,
            email: fresh.customerEmail,
            fullName: fresh.shippingAddress?.fullName || "Valued Client",
            status: "CANCELLED",
          },
        },
      ];

      if (wasPaid) {
        jobsToQueue.push({
          type: "SEND_CONCIERGE_ALERT",
          idempotencyKey: `paid-cancel-alert-${fresh.orderNumber}-${Date.now()}`,
          payload: {
            orderNumber: fresh.orderNumber,
            email: fresh.customerEmail,
            fullName: fresh.shippingAddress?.fullName || "Valued Client",
            totalInr: Math.round(fresh.totalPaise / 100),
            razorpayPaymentId: fresh.razorpayPaymentId,
            note: "Customer cancelled a PAID order. Stock has been restored — please issue Razorpay refund from Admin Orders.",
          },
        });
      }

      await Job.create(jobsToQueue, { session, ordered: true });
    });
  } finally {
    await session.endSession();
  }

  appCache.invalidatePrefix("catalog:");
  return Order.findById(order._id).lean();
}

export async function requestCustomerReturn(req, orderNumber, reason) {
  const order = await Order.findOne({ orderNumber, userId: req.user._id });
  if (!order) throw ApiError.notFound("Order not found");

  if (order.status !== "DELIVERED") {
    throw ApiError.badRequest("Returns can only be requested for delivered orders.");
  }

  const deliveredTs = order.deliveredAt
    ? new Date(order.deliveredAt).getTime()
    : new Date(order.updatedAt).getTime();
  if (Date.now() - deliveredTs > RETURN_WINDOW_MS) {
    throw ApiError.badRequest("The 7-day return window for this order has expired.");
  }

  order.status = "RETURN_REQUESTED";
  order.returnRequest = {
    reason: reason.trim(),
    requestedAt: new Date(),
    reviewedAt: null,
    reviewedBy: "",
    adminNote: "",
  };
  await order.save();

  await Job.create({
    type: "SEND_ORDER_STATUS_UPDATE",
    idempotencyKey: `order-return-req-${order.orderNumber}-${Date.now()}`,
    payload: {
      orderNumber: order.orderNumber,
      email: order.customerEmail,
      fullName: order.shippingAddress?.fullName || "Valued Client",
      status: "RETURN_REQUESTED",
    },
  });

  return order.toObject();
}

export async function executeOrderRefundAndRestock(
  orderId,
  { reason = "Refund approved by DIVARA Atelier", restock = true }
) {
  const lockKey = String(orderId);
  if (activeRefundLocks.has(lockKey)) {
    throw ApiError.conflict("A refund is already in progress for this order.");
  }

  activeRefundLocks.add(lockKey);
  try {
    const order = await Order.findById(orderId);
    if (!order) throw ApiError.notFound("Order not found");
    if (order.status === "REFUNDED") {
      throw ApiError.badRequest("This order has already been refunded.");
    }
    if (!order.paidAt && !order.razorpayPaymentId) {
      throw ApiError.badRequest("Unpaid orders cannot be refunded.");
    }

    let razorpayRefundId = null;
    const rzp = getRazorpayClient();
    if (rzp && order.razorpayPaymentId) {
      try {
        const rzpRefund = await rzp.payments.refund(order.razorpayPaymentId, {
          amount: order.totalPaise,
          speed: "normal",
          notes: { orderNumber: order.orderNumber, reason },
        });
        razorpayRefundId = rzpRefund.id;
      } catch (err) {
        throw ApiError.badRequest(
          `Razorpay refund failed: ${err?.error?.description || err.message || "Unknown gateway error"}`
        );
      }
    }

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const fresh = await Order.findById(order._id).session(session);
        if (restock) {
          await restoreOrderStockInSession(fresh, session);
        }
        fresh.status = "REFUNDED";
        fresh.refund = {
          razorpayRefundId,
          amountPaise: fresh.totalPaise,
          refundedAt: new Date(),
          reason,
        };
        await fresh.save({ session });

        await Job.create(
          [
            {
              type: "SEND_ORDER_STATUS_UPDATE",
              idempotencyKey: `order-refund-${fresh.orderNumber}-${Date.now()}`,
              payload: {
                orderNumber: fresh.orderNumber,
                email: fresh.customerEmail,
                fullName: fresh.shippingAddress?.fullName || "Valued Client",
                status: "REFUNDED",
              },
            },
          ],
          { session, ordered: true }
        );
      });
    } finally {
      await session.endSession();
    }

    appCache.invalidatePrefix("catalog:");
    return Order.findById(order._id).lean();
  } finally {
    activeRefundLocks.delete(lockKey);
  }
}

export async function processRazorpayWebhook({ rawBody, signature, eventId }) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw ApiError.badRequest("Razorpay webhook secret is not configured");
  }

  if (!Buffer.isBuffer(rawBody)) {
    throw ApiError.badRequest("Webhook requires raw JSON body");
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

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw ApiError.badRequest("Malformed JSON webhook payload");
  }

  const eventType = payload.event;
  const paymentEntity = payload?.payload?.payment?.entity;
  const refundEntity = payload?.payload?.refund?.entity;
  const rzpOrderId = paymentEntity?.order_id || payload?.payload?.order?.entity?.id;
  const rzpPaymentId = paymentEntity?.id || refundEntity?.payment_id || null;
  const dedupeId = eventId || `${eventType}:${rzpPaymentId || Date.now()}`;

  try {
    await WebhookEvent.create({ eventId: dedupeId, eventType });
  } catch (err) {
    if (err.code === 11000) return { duplicate: true };
    throw err;
  }

  try {
    if (eventType === "refund.processed" && rzpPaymentId) {
      const order = await Order.findOne({ razorpayPaymentId: rzpPaymentId });
      if (order && order.status !== "REFUNDED") {
        const isFullRefund = !refundEntity?.amount || refundEntity.amount >= order.totalPaise;
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            const fresh = await Order.findById(order._id).session(session);
            if (isFullRefund) {
              await restoreOrderStockInSession(fresh, session);
              fresh.status = "REFUNDED";
            }
            fresh.refund = {
              razorpayRefundId: refundEntity?.id || null,
              amountPaise: refundEntity?.amount || fresh.totalPaise,
              refundedAt: new Date(),
              reason: isFullRefund
                ? "Processed via Razorpay Webhook"
                : "Partial refund processed via Razorpay Webhook",
            };
            await fresh.save({ session });
          });
        } finally {
          await session.endSession();
        }
        appCache.invalidatePrefix("catalog:");
      }
      return { refunded: true, eventType };
    }

    if (eventType === "payment.failed") {
      const failedOrder = await Order.findOne({ razorpayOrderId: rzpOrderId }).lean();
      if (failedOrder && failedOrder.status === "PENDING_PAYMENT") {
        const failKey = `admin-fail-${failedOrder.orderNumber}-${rzpPaymentId || Date.now()}`;
        const exists = await Job.exists({ idempotencyKey: failKey });
        if (!exists) {
          await Job.create({
            type: "SEND_ADMIN_ORDER_FAILURE",
            idempotencyKey: failKey,
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
      }
      return { recordedFailure: true, eventType };
    }

    if (eventType !== "payment.captured" && eventType !== "order.paid") {
      return { ignored: true, eventType };
    }

    const order = await Order.findOne({ razorpayOrderId: rzpOrderId });
    return await finalizePaidOrder(order, rzpPaymentId);
  } catch (processingErr) {
    await WebhookEvent.deleteOne({ eventId: dedupeId }).catch(() => {});
    throw processingErr;
  }
}