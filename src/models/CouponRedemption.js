import mongoose from "mongoose";

const couponRedemptionSchema = new mongoose.Schema(
  {
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      required: true,
      index: true,
    },
    couponCode: {
      type: String,
      required: true,
      uppercase: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      unique: true,
    },
    discountPaise: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ["RESERVED", "REDEEMED", "RELEASED"],
      default: "RESERVED",
    },
  },
  { timestamps: true }
);

couponRedemptionSchema.index({ couponId: 1, userId: 1, status: 1 });

export const CouponRedemption = mongoose.model("CouponRedemption", couponRedemptionSchema);