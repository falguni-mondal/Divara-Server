import mongoose from "mongoose";

const policySectionSchema = new mongoose.Schema(
  {
    heading: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const policyPageSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      enum: ["privacy-policy", "terms-of-service", "shipping-returns"],
      required: true,
      unique: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      default: "",
      trim: true,
    },
    effectiveDate: {
      type: String,
      required: true,
    },
    sections: {
      type: [policySectionSchema],
      default: [],
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

export const PolicyPage = mongoose.model("PolicyPage", policyPageSchema);