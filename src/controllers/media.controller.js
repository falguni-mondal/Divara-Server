import {
  getImageKitAuthParams,
  uploadReviewImageBuffer,
  deleteImageKitFile,
} from "../config/imagekit.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ApiError } from "../utils/apiError.js";

function detectAllowedImageExt(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  // WebP: RIFF....WEBP
  if (
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export async function getImageKitUploadAuth(_req, res) {
  const authParams = getImageKitAuthParams();
  return sendSuccess(res, { data: authParams });
}

export async function uploadCustomerReviewImage(req, res) {
  const buffer = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buffer || buffer.length === 0) {
    throw ApiError.badRequest("Please select a valid JPEG, PNG, or WebP image.");
  }

  const ext = detectAllowedImageExt(buffer);
  if (!ext) {
    throw ApiError.badRequest("Only JPEG, PNG, and WebP images are allowed for reviews.");
  }

  const uploaded = await uploadReviewImageBuffer({ buffer, ext });
  return sendSuccess(res, { statusCode: 201, data: uploaded });
}

export async function removeImageKitAsset(req, res) {
  await deleteImageKitFile(req.params.fileId);
  return sendSuccess(res, { message: "Media asset removed from ImageKit" });
}