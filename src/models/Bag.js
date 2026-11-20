import mongoose from "mongoose";

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
      enum: ["XS", "S", "M", "L", "XL", "Free Size"],
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