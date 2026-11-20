import cron from "node-cron";
import mongoose from "mongoose";
import { Reservation } from "../models/Reservation.js";
import { Product } from "../models/Product.js";
import { Order } from "../models/Order.js";
import { Coupon } from "../models/Coupon.js";
import { CouponRedemption } from "../models/CouponRedemption.js";
import { appCache } from "../utils/lruCache.js";

let isSweeping = false;

async function sweepExpiredReservations() {
  if (isSweeping) return;
  isSweeping = true;

  try {
    const expiredHolds = await Reservation.find({
      status: "HELD",
      expiresAt: { $lte: new Date() },
    }).limit(25);

    if (expiredHolds.length === 0) return;

    let releasedCount = 0;

    for (const hold of expiredHolds) {
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          const locked = await Reservation.findOneAndUpdate(
            { _id: hold._id, status: "HELD" },
            { $set: { status: "RELEASED" } },
            { session, returnDocument: "after" }
          );
          if (!locked) return;

          for (const item of locked.items) {
            await Product.updateOne(
              {
                _id: item.productId,
                variants: { $elemMatch: { size: item.size, stockReserved: { $gte: item.quantity } } },
              },
              { $inc: { "variants.$.stockReserved": -item.quantity } },
              { session }
            );
          }

          await Order.updateOne(
            { _id: locked.orderId, status: "PENDING_PAYMENT" },
            {
              $set: {
                status: "CANCELLED",
                cancelledAt: new Date(),
                cancelReason: "Checkout reservation expired (15m)",
                stockRestored: true,
              },
            },
            { session }
          );

          const releasedRedemption = await CouponRedemption.findOneAndUpdate(
            { orderId: locked.orderId, status: "RESERVED" },
            { $set: { status: "RELEASED" } },
            { session, returnDocument: "after" }
          );
          if (releasedRedemption) {
            await Coupon.updateOne(
              { _id: releasedRedemption.couponId, usedCount: { $gt: 0 } },
              { $inc: { usedCount: -1 } },
              { session }
            );
          }

          releasedCount += 1;
        });
      } catch (holdErr) {
        console.error(`[ReservationReclaimer] Failed hold ${hold._id}:`, holdErr.message);
      } finally {
        await session.endSession();
      }
    }

    if (releasedCount > 0) {
      appCache.invalidatePrefix("catalog:");
      console.log(`[ReservationReclaimer] Released ${releasedCount} expired stock hold(s).`);
    }
  } catch (error) {
    console.error("[ReservationReclaimer] Sweep error:", error.message);
  } finally {
    isSweeping = false;
  }
}

export function startReservationReclaimer() {
  return cron.schedule("* * * * *", sweepExpiredReservations);
}