import { getImageKitAuthParams, deleteImageKitFile } from "../config/imagekit.js";
import { sendSuccess } from "../utils/apiResponse.js";

export async function getImageKitUploadAuth(_req, res) {
  const authParams = getImageKitAuthParams();
  return sendSuccess(res, { data: authParams });
}

export async function removeImageKitAsset(req, res) {
  await deleteImageKitFile(req.params.fileId);
  return sendSuccess(res, { message: "Media asset removed from ImageKit" });
}