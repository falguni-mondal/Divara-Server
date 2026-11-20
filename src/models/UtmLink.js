import mongoose from "mongoose";

const utmLinkSchema = new mongoose.Schema(
  {
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    targetPath: {
      type: String,
      default: "/",
      trim: true,
      maxlength: 260,
    },
    utmSource: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 80,
      index: true,
    },
    utmMedium: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 80,
    },
    utmCampaign: {
      type: String,
      default: "",
      lowercase: true,
      trim: true,
      maxlength: 120,
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
    fullUrl: {
      type: String,
      required: true,
      trim: true,
      maxlength: 600,
    },
    createdByEmail: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
  },
  { timestamps: true }
);

utmLinkSchema.index({ createdAt: -1 });

export const UtmLink = mongoose.model("UtmLink", utmLinkSchema);