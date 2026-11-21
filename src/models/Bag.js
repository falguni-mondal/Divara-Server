import mongoose from "mongoose";
import { VALID_SIZES } from "./Product.js";

const bagItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      required: true,
    },
    slug: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    size: {
      type: String,
      enum: VALID_SIZES,
      required: true,
    },
    price: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1, max: 10 },
    image: { type: String, required: true },
  },
  { _id: true }
);

const bagSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    items: {
      type: [bagItemSchema],
      default: [],
    },
  },
  { timestamps: true }
);

export const Bag = mongoose.model("Bag", bagSchema);