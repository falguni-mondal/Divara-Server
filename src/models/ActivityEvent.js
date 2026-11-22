import mongoose from "mongoose";

const productSnapshotSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    slug: { type: String, default: "", maxlength: 180 },
    title: { type: String, default: "", maxlength: 220 },
    sku: { type: String, default: "", maxlength: 80 },
    primaryImage: { type: String, default: "", maxlength: 600 },
    category: { type: String, default: "", maxlength: 80 },
    fabric: { type: String, default: "", maxlength: 80 },
    color: { type: String, default: "", maxlength: 80 },
    size: { type: String, default: "", maxlength: 40 },
    price: { type: Number, default: 0 },
  },
  { _id: false }
);

const cartItemSnapshotSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
    slug: { type: String, default: "", maxlength: 180 },
    title: { type: String, default: "", maxlength: 220 },
    sku: { type: String, default: "", maxlength: 80 },
    primaryImage: { type: String, default: "", maxlength: 600 },
    size: { type: String, default: "", maxlength: 40 },
    quantity: { type: Number, default: 1 },
    price: { type: Number, default: 0 },
  },
  { _id: false }
);

const activityEventSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
      index: true,
      trim: true,
      maxlength: 64,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: ["PAGE_VIEW", "ACTION", "CART_SNAPSHOT", "AUTH", "CHECKOUT"],
      index: true,
    },
    status: {
      type: String,
      enum: ["INFO", "SUCCESS", "FAILED", "WARNING"],
      default: "INFO",
      index: true,
    },
    actionName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 120,
    },
    pageName: {
      type: String,
      default: "",
      trim: true,
      maxlength: 140,
    },
    path: {
      type: String,
      default: "",
      trim: true,
      maxlength: 320,
    },
    pageViewId: {
      type: String,
      default: "",
      trim: true,
      maxlength: 80,
      index: true,
    },
    activeDurationSec: {
      type: Number,
      default: 0,
      min: 0,
    },
    product: {
      type: productSnapshotSchema,
      default: null,
    },
    cartItems: {
      type: [cartItemSnapshotSchema],
      default: [],
    },
    cartTotal: {
      type: Number,
      default: 0,
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    mergedFromVisitor: {
      type: Boolean,
      default: false,
    },
    occurredAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// Auto-expire raw activity logs after 180 days (MongoDB TTL)
activityEventSchema.index(
  { occurredAt: 1 },
  { expireAfterSeconds: 180 * 24 * 60 * 60 }
);

// Fast lookup indexes for Account timeline, Visitor timeline, and login merge
activityEventSchema.index({ userId: 1, occurredAt: -1 });
activityEventSchema.index({ deviceId: 1, userId: 1, occurredAt: -1 });
activityEventSchema.index({ deviceId: 1, pageViewId: 1 });

export const ActivityEvent = mongoose.model("ActivityEvent", activityEventSchema);