import mongoose from "mongoose";

export const CATEGORY_LABELS = Object.freeze({
  saree: "Sarees",
  dress: "Dresses",
  denim: "Denim Wears",
  shirt: "Shirts",
});

const mediaItemSchema = new mongoose.Schema(
  {
    url: { type: String, required: true, trim: true },
    fileId: { type: String, default: null }, // ImageKit fileId for cleanup on edit/delete
    alt: { type: String, default: "" },
  },
  { _id: false }
);

const variantSchema = new mongoose.Schema(
  {
    size: {
      type: String,
      enum: ["XS", "S", "M", "L", "XL", "Free Size"],
      required: true,
    },
    sku: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    stockOnHand: {
      type: Number,
      required: true,
      min: 0,
      default: 5,
    },
    stockReserved: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
  },
  { _id: true }
);

const productSchema = new mongoose.Schema(
  {
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["saree", "dress", "denim", "shirt"],
      required: true,
    },
    categoryLabel: {
      type: String,
      required: true,
      trim: true,
    },
    season: {
      type: String,
      enum: ["Winter", "Spring", "Summer", "Autumn"],
      required: true,
    },
    color: {
      type: String,
      required: true,
      trim: true,
    },
    colorHex: {
      type: String,
      required: true,
      match: /^#[0-9a-fA-F]{6}$/,
    },
    fabric: {
      type: String,
      required: true,
      trim: true,
    },
    // Price in integer INR (matches catalogData.js & ₹10,000–₹70,000 slider)
    price: {
      type: Number,
      required: true,
      min: 1000,
    },
    // Integer paise for exact Razorpay math (price * 100)
    pricePaise: {
      type: Number,
      required: true,
      min: 100000,
    },
    // Primary ImageKit media asset
    imageMedia: {
      type: mediaItemSchema,
      required: true,
    },
    // Ordered ImageKit gallery assets
    galleryMedia: {
      type: [mediaItemSchema],
      default: [],
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    craftNotes: {
      type: [String],
      default: [],
    },
    variants: {
      type: [variantSchema],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one size variant is required",
      },
    },
    isFeatured: {
      type: Boolean,
      default: false,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Auto-sync categoryLabel and pricePaise before validation
productSchema.pre("validate", function () {
  if (this.category && !this.categoryLabel) {
    this.categoryLabel = CATEGORY_LABELS[this.category] || this.category;
  }
  if (typeof this.price === "number") {
    this.pricePaise = Math.round(this.price * 100);
  }
});

// Compound ESR index for /collections multi-facet filtering & price sorting
productSchema.index({
  isActive: 1,
  category: 1,
  season: 1,
  color: 1,
  fabric: 1,
  price: 1,
});

// Weighted text index for SearchOverlay.jsx instant search
productSchema.index(
  {
    title: "text",
    categoryLabel: "text",
    fabric: "text",
    color: "text",
    season: "text",
    description: "text",
  },
  {
    weights: {
      title: 10,
      categoryLabel: 6,
      fabric: 5,
      color: 4,
      season: 4,
      description: 1,
    },
    name: "product_search_text_idx",
  }
);

/**
 * Formats a MongoDB Product document into the exact shape consumed by the DIVARA Next.js frontend.
 */
productSchema.statics.toFrontendDTO = function (doc) {
  const availableSizes = (doc.variants || [])
    .filter((v) => v.stockOnHand - v.stockReserved > 0)
    .map((v) => v.size);

  const allSizes = (doc.variants || []).map((v) => v.size);

  return {
    _id: String(doc._id),
    id: doc.slug,
    slug: doc.slug,
    title: doc.title,
    category: doc.category,
    categoryLabel: doc.categoryLabel,
    season: doc.season,
    color: doc.color,
    colorHex: doc.colorHex,
    fabric: doc.fabric,
    price: doc.price,
    sizes: availableSizes.length > 0 ? availableSizes : allSizes,
    variants: (doc.variants || []).map((v) => ({
      size: v.size,
      sku: v.sku,
      availableStock: Math.max(0, v.stockOnHand - v.stockReserved),
    })),
    image: doc.imageMedia?.url || "",
    imageFileId: doc.imageMedia?.fileId || null,
    gallery: (doc.galleryMedia || []).map((g) => g.url),
    description: doc.description,
    craftNotes: doc.craftNotes || [],
    isFeatured: Boolean(doc.isFeatured),
  };
};

export const Product = mongoose.model("Product", productSchema);