import mongoose from "mongoose";

const reviewImageSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    fileId: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
      index: true,
    },
    productSlug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Null when isSeeded === true (Admin-seeded review)
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isSeeded: {
      type: Boolean,
      default: false,
      index: true,
    },
    reviewerName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    comment: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },
    images: {
      type: [reviewImageSchema],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length <= 3,
        message: "You can upload a maximum of 3 images per review",
      },
    },
    isVerifiedPurchase: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ["PUBLISHED", "PENDING", "HIDDEN"],
      default: "PUBLISHED",
      index: true,
    },
  },
  { timestamps: true }
);

// Real users remain strictly 1 review per product; Admin can seed multiple reviews per product
reviewSchema.index(
  { productId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } }
);
reviewSchema.index({ productId: 1, status: 1, createdAt: -1 });

export const Review = mongoose.model("Review", reviewSchema);