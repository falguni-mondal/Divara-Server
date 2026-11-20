import mongoose from "mongoose";

const cmsMediaSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    fileId: { type: String, default: null },
  },
  { _id: false }
);

const siteContentSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      unique: true,
      default: "global",
      index: true,
    },
    hero: {
      desktopImage: { type: cmsMediaSchema, required: true },
      mobileImage: { type: cmsMediaSchema, required: true },
      ctaLabel: { type: String, default: "SHOP NOW" },
      scrollPrompt: { type: String, default: "Scroll to Discover More" },
    },
    categories: [
      {
        id: { type: String, enum: ["saree", "dress", "denim", "shirt"], required: true },
        title: { type: String, required: true },
        poster: { type: cmsMediaSchema, required: true },
        path: { type: String, required: true },
      },
    ],
    collectionBanner: {
      desktopImage: { type: cmsMediaSchema, required: true },
      mobileImage: { type: cmsMediaSchema, required: true },
      ctaLabel: { type: String, default: "SHOP NOW" },
    },
    philosophy: {
      eyebrow: { type: String, default: "featuring" },
      heading: { type: String, default: "THE DIVARA CRAFTSMANSHIP" },
      paragraphs: { type: [String], default: [] },
      video: { type: cmsMediaSchema, required: true },
      ctaLabel: { type: String, default: "READ OUR STORY" },
    },
    luxuryPillars: [
      {
        heading: { type: String, required: true },
        paragraph: { type: String, required: true },
        image: { type: cmsMediaSchema, default: null },
        video: { type: cmsMediaSchema, default: null },
      },
    ],
    contact: {
      bannerImage: { type: cmsMediaSchema, required: true },
      email: { type: String, default: "support@divara.byfalguni.com" },
      phone: { type: String, default: "+91 (033) 2284-9100" },
      supportHours: { type: String, default: "Monday – Saturday, 10:00 AM to 8:00 PM IST" },
      locations: { type: [String], default: ["Kolkata", "Mumbai", "New Delhi"] },
      faqs: [
        {
          question: { type: String, required: true },
          answer: { type: String, required: true },
        },
      ],
    },
    trendingSearches: {
      type: [String],
      default: [
        "Kanjivaram",
        "Sarees",
        "Dresses",
        "Winter",
        "Silk",
        "Velvet",
        "Chanderi",
        "Denim",
      ],
    },
  },
  { timestamps: true }
);

export const SiteContent = mongoose.model("SiteContent", siteContentSchema);