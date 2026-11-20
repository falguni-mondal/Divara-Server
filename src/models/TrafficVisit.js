import mongoose from "mongoose";

const trafficVisitSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    landingPath: {
      type: String,
      default: "/",
      trim: true,
      maxlength: 300,
    },
    utmSource: {
      type: String,
      default: "direct",
      lowercase: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    utmMedium: {
      type: String,
      default: "none",
      lowercase: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    utmCampaign: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      maxlength: 120,
      index: true,
    },
    utmContent: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      maxlength: 120,
    },
    referralPerson: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      maxlength: 100,
      index: true,
    },
    referrerHost: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      maxlength: 160,
    },
    deviceType: {
      type: String,
      enum: ["mobile", "tablet", "desktop"],
      default: "desktop",
    },
  },
  { timestamps: true }
);

// Auto-expire raw visits after 180 days (zero-Redis MongoDB TTL)
trafficVisitSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 24 * 60 * 60 });
trafficVisitSchema.index({ createdAt: -1, utmSource: 1 });
trafficVisitSchema.index({ createdAt: -1, referralPerson: 1 });

export const TrafficVisit = mongoose.model("TrafficVisit", trafficVisitSchema);