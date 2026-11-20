import mongoose from "mongoose";

const authOtpSchema = new mongoose.Schema(
  {
    purpose: {
      type: String,
      enum: ["CUSTOMER_REGISTER", "ADMIN_LOGIN"],
      required: true,
      index: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    sentToEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    // Pending registration payload stored safely until Customer OTP is verified
    pendingFullName: { type: String, default: "" },
    pendingPasswordHash: { type: String, default: null },
    otpHash: {
      type: String,
      required: true,
    },
    attempts: {
      type: Number,
      default: 0,
    },
    isUsed: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

authOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthOtp = mongoose.model("AuthOtp", authOtpSchema);