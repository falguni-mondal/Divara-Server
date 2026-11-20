import mongoose from "mongoose";

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
    // Auto-capitalized display name (e.g. "WINTER ROYALTY SALE")
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
    // Percentage (1–100) or Fixed amount in INR
    discountValue: {
      type: Number,
      required: true,
      min: 1,
    },
    // Optional cap in INR when discountType === "PERCENTAGE" (null = uncapped)
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
    // Can be a past, current, or future date/time
    startsAt: {
      type: Date,
      required: true,
    },
    // Null means no expiration date
    endsAt: {
      type: Date,
      default: null,
    },
    // Global usage limit: null = infinite overall usage
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
    // Per-user usage limit: 1 = once per user, N = multiple, null = unlimited per user
    maxUsesPerUser: {
      type: Number,
      default: 1,
      min: 1,
    },
    // Scope targeting
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
        enum: ["saree", "dress", "denim", "shirt"],
      },
    ],
    seasons: [
      {
        type: String,
        enum: ["Winter", "Spring", "Summer", "Autumn"],
      },
    ],
    // User targeting (empty arrays = open to all signed-in users)
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