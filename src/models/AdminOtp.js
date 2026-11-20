import mongoose from "mongoose";

const adminOtpSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    loginEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    sentToEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
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
    // MongoDB native TTL auto-deletes expired OTPs (zero Redis)
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

adminOtpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AdminOtp = mongoose.model("AdminOtp", adminOtpSchema);