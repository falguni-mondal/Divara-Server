import { Router } from "express";
import { searchRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import {
  listProducts,
  getProductDetail,
  searchProducts,
} from "../../controllers/catalog.controller.js";

const router = Router();

router.get("/", listProducts);
router.get("/search", searchRateLimiter, searchProducts);
router.get("/:slug", getProductDetail);

export default router;