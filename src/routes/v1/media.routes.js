import { Router } from "express";
import { requireAuth, requireAdmin } from "../../middlewares/auth.middleware.js";
import { formRateLimiter } from "../../middlewares/rateLimit.middleware.js";
import { getImageKitUploadAuth, removeImageKitAsset } from "../../controllers/media.controller.js";

const router = Router();

// Signed ImageKit upload auth for signed-in users uploading up to 3 review photos
router.get("/review-upload-auth", requireAuth, formRateLimiter, getImageKitUploadAuth);

// Admin-only ImageKit upload auth & asset deletion (used by the upcoming Admin Panel)
router.get("/imagekit-auth", requireAuth, requireAdmin, getImageKitUploadAuth);
router.delete("/:fileId", requireAuth, requireAdmin, removeImageKitAsset);

export default router;