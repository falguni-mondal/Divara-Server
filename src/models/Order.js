import mongoose from "mongoose";

const orderItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    slug: { type: String, required: true },
    title: { type: String, required: true },
    category: { type: String, required: true },
    size: { type: String, required: true },
    sku: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    image: { type: String, required: true },
  },
  { _id: false }
);

const shippingAddressSchema = new mongoose.Schema(
  {
    fullName: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: "", trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, default: "India", trim: true },
  },
  { _id: false }
);

const attributionSchema = new mongoose.Schema(
  {
    utmSource: { type: String, default: "direct", lowercase: true, trim: true },
    utmMedium: { type: String, default: "none", lowercase: true, trim: true },
    utmCampaign: { type: String, default: "", lowercase: true, trim: true },
    utmContent: { type: String, default: "", lowercase: true, trim: true },
    referralPerson: { type: String, default: "", lowercase: true, trim: true },
    landingPath: { type: String, default: "/", trim: true },
  },
  { _id: false }
);

const returnRequestSchema = new mongoose.Schema(
  {
    reason: { type: String, default: "", trim: true, maxlength: 500 },
    requestedAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: "" },
    adminNote: { type: String, default: "", trim: true, maxlength: 500 },
  },
  { _id: false }
);

const refundSchema = new mongoose.Schema(
  {
    razorpayRefundId: { type: String, default: null },
    amountPaise: { type: Number, default: 0 },
    refundedAt: { type: Date, default: null },
    reason: { type: String, default: "" },
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    customerEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    items: {
      type: [orderItemSchema],
      required: true,
    },
    shippingAddress: {
      type: shippingAddressSchema,
      required: true,
    },
    attribution: {
      type: attributionSchema,
      default: () => ({}),
    },
    couponId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Coupon",
      default: null,
    },
    couponCode: {
      type: String,
      default: null,
    },
    // CA-Ready Indian GST Accounting Fields (Final MRP is GST-Inclusive)
    subtotalPaise: { type: Number, required: true, min: 0 },
    discountPaise: { type: Number, default: 0, min: 0 },
    taxableBasePaise: { type: Number, default: 0, min: 0 },
    gstRatePercent: { type: Number, default: 12 },
    taxType: {
      type: String,
      enum: ["CGST_SGST", "IGST"],
      default: "IGST",
    },
    cgstPaise: { type: Number, default: 0, min: 0 },
    sgstPaise: { type: Number, default: 0, min: 0 },
    igstPaise: { type: Number, default: 0, min: 0 },
    gstPaise: { type: Number, required: true, min: 0 },
    hsnCode: { type: String, default: "6204" },
    shippingPaise: { type: Number, default: 0, min: 0 },
    totalPaise: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    razorpayOrderId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    razorpayPaymentId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: [
        "PENDING_PAYMENT",
        "PAID",
        "PROCESSING",
        "SHIPPED",
        "DELIVERED",
        "RETURN_REQUESTED",
        "RETURN_APPROVED",
        "RETURN_REJECTED",
        "CANCELLED",
        "CONCIERGE_REVIEW",
        "REFUNDED",
      ],
      default: "PENDING_PAYMENT",
      index: true,
    },
    paidAt: { type: Date, default: null },
    deliveredAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: "", trim: true },
    returnRequest: {
      type: returnRequestSchema,
      default: () => ({}),
    },
    refund: {
      type: refundSchema,
      default: () => ({}),
    },
    stockRestored: {
      type: Boolean,
      default: false,
    },
    trackingNumber: { type: String, default: null },
    courierName: { type: String, default: null },
  },
  { timestamps: true }
);

orderSchema.index({ userId: 1, createdAt: -1 });
orderSchema.index({ "attribution.utmSource": 1, status: 1 });
orderSchema.index({ "attribution.referralPerson": 1, status: 1 });

export const Order = mongoose.model("Order", orderSchema);