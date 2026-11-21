import { Router } from "express";
import { z } from "zod";
import { searchRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { VALID_SIZES } from "../../models/Product.js";
import {
  listProducts,
  getProductDetail,
  getProductStock,
  validateStockBatch,
  searchProducts,
} from "../../controllers/catalog.controller.js";

const router = Router();

const validSizes = z.enum(VALID_SIZES);

const stockValidateSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        size: validSizes,
        quantity: z.coerce.number().int().min(1).max(99).default(1),
      })
    )
    .min(1)
    .max(30),
});

router.get("/", listProducts);
router.get("/search", searchRateLimiter, searchProducts);
router.post("/stock/validate", searchRateLimiter, validate(stockValidateSchema), validateStockBatch);
router.get("/:slug/stock", getProductStock);
router.get("/:slug", getProductDetail);

export default router;