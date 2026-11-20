import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [
        "SEND_WELCOME_EMAIL",
        "SEND_ORDER_CONFIRMATION",
        "SEND_ADMIN_ORDER_SUCCESS",
        "SEND_ADMIN_ORDER_FAILURE",
        "SEND_ORDER_STATUS_UPDATE",
        "SEND_CONTACT_ACK",
        "SEND_ADMIN_NEW_TICKET",
        "SEND_CONTACT_ADMIN_REPLY",
        "SEND_NEWSLETTER_WELCOME",
        "SEND_CONCIERGE_ALERT",
      ],
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    idempotencyKey: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "DONE", "FAILED"],
      default: "PENDING",
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    lastError: {
      type: String,
      default: null,
    },
    runAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

jobSchema.index({ status: 1, runAt: 1 });
jobSchema.index({ completedAt: 1 }, { expireAfterSeconds: 86400 });

export const Job = mongoose.model("Job", jobSchema);