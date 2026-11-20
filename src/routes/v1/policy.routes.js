import { Router } from "express";
import { listPolicies, getPolicyBySlug } from "../../controllers/policy.controller.js";

const router = Router();

router.get("/", listPolicies);
router.get("/:slug", getPolicyBySlug);

export default router;