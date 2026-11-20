import mongoose from "mongoose";

const reservedItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    slug: { type: String, required: true },
    size: {
      type: String,
      enum: ["XS", "S", "M", "L", "XL", "Free Size"],
      required: true,
    },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false }
);

const reservationSchema = new mongoose.Schema(
  {
    checkoutToken: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    guestToken: {
      type: String,
      default: null,
    },
    items: {
      type: [reservedItemSchema],
      required: true,
    },
    status: {
      type: String,
      enum: ["HELD", "COMMITTED", "RELEASED"],
      default: "HELD",
    },
    // 15-minute lock window checked by the 60s node-cron reclaimer
    expiresAt: {
      type: Date,
      required: true,
    },
    // Auto-purge old COMMITTED/RELEASED reservation records after 7 days
    purgeAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  },
  { timestamps: true }
);

reservationSchema.index({ status: 1, expiresAt: 1 });
reservationSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export const Reservation = mongoose.model("Reservation", reservationSchema);