import { SiteContent } from "../models/SiteContent.js";
import { appCache } from "../utils/lruCache.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

const CMS_CACHE_KEY = "cms:global";

export async function getSiteContent(_req, res) {
  const cached = appCache.get(CMS_CACHE_KEY);
  if (cached) {
    return sendSuccess(res, { data: cached });
  }

  const content = await SiteContent.findOne({ key: "global" }).lean();
  if (!content) {
    throw ApiError.notFound("Site content has not been seeded yet. Run npm run seed.");
  }

  appCache.set(CMS_CACHE_KEY, content, 300_000);
  return sendSuccess(res, { data: content });
}