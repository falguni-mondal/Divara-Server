import mongoose from "mongoose";
import { CATEGORY_LABELS } from "./Product.js";

const couponSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      default: "",
      trim: true,
      maxlength: 500,
    },
    discountType: {
      type: String,
      enum: ["PERCENTAGE", "FIXED"],
      required: true,
    },
    discountValue: {
      type: Number,
      required: true,
      min: 1,
    },
    maxDiscountInr: {
      type: Number,
      default: null,
      min: 1,
    },
    applyMode: {
      type: String,
      enum: ["MANUAL", "AUTO"],
      default: "MANUAL",
      index: true,
    },
    startsAt: {
      type: Date,
      required: true,
    },
    endsAt: {
      type: Date,
      default: null,
    },
    maxTotalUses: {
      type: Number,
      default: null,
      min: 1,
    },
    usedCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxUsesPerUser: {
      type: Number,
      default: 1,
      min: 1,
    },
    applicableTo: {
      type: String,
      enum: ["ALL", "SPECIFIC_PRODUCTS", "SPECIFIC_CATEGORIES", "SPECIFIC_SEASONS"],
      default: "ALL",
    },
    productIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Product",
      },
    ],
    categories: [
      {
        type: String,
        enum: Object.keys(CATEGORY_LABELS),
      },
    ],
    seasons: [
      {
        type: String,
        enum: ["Winter", "Spring", "Summer", "Autumn"],
      },
    ],
    eligibleUserIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    eligibleEmails: [
      {
        type: String,
        lowercase: true,
        trim: true,
      },
    ],
    firstOrderOnly: {
      type: Boolean,
      default: false,
    },
    minOrderSubtotal: {
      type: Number,
      default: 0,
      min: 0,
    },
    minItemQuantity: {
      type: Number,
      default: 1,
      min: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

couponSchema.index({ isActive: 1, applyMode: 1, startsAt: 1, endsAt: 1 });

export const Coupon = mongoose.model("Coupon", couponSchema);