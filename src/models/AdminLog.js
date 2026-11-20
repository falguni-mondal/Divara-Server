import mongoose from "mongoose";

const adminLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    actorEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["admin", "super_admin", "unknown"],
      default: "admin",
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["SUCCESS", "FAILED"],
      default: "SUCCESS",
      index: true,
    },
    targetType: {
      type: String,
      default: "system",
    },
    targetId: {
      type: String,
      default: null,
    },
    summary: {
      type: String,
      required: true,
      maxlength: 500,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    ipAddress: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

adminLogSchema.index({ createdAt: -1 });
adminLogSchema.index({ actorEmail: 1, createdAt: -1 });

export const AdminLog = mongoose.model("AdminLog", adminLogSchema);