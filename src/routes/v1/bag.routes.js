import { Router } from "express";
import { z } from "zod";
import { requireAuth, blockAdminShopping } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  getBag,
  addBagItem,
  updateBagItem,
  toggleWishlistItem,
} from "../../controllers/bag.controller.js";
import { VALID_SIZES } from "../../models/Product.js";

const router = Router();
const validSizes = z.enum(VALID_SIZES);

const addItemSchema = z.object({
  productId: z.string().min(1),
  size: validSizes.default("M"),
  quantity: z.coerce.number().int().min(1).max(10).default(1),
});

const updateItemSchema = z
  .object({
    productId: z.string().min(1),
    size: validSizes,
    delta: z.coerce.number().int().min(-10).max(10).optional(),
    quantity: z.coerce.number().int().min(0).max(10).optional(),
  })
  .refine((d) => typeof d.delta === "number" || typeof d.quantity === "number", {
    message: "Either delta or quantity is required",
  });

const wishlistSchema = z.object({
  productId: z.string().min(1),
});

router.use(requireAuth, blockAdminShopping);

router.get("/", getBag);
router.post("/items", validate(addItemSchema), addBagItem);
router.patch("/items", validate(updateItemSchema), updateBagItem);
router.post("/wishlist/toggle", validate(wishlistSchema), toggleWishlistItem);

export default router;