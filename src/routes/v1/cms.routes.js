import { Router } from "express";
import { getSiteContent } from "../../controllers/cms.controller.js";

const router = Router();

router.get("/site-content", getSiteContent);

export default router;