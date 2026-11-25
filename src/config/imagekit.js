import crypto from "crypto";
import ImageKit from "imagekit";
import { env } from "./env.js";

let imagekitInstance = null;

export function getImageKit() {
  if (!env.IMAGEKIT_PUBLIC_KEY || !env.IMAGEKIT_PRIVATE_KEY || !env.IMAGEKIT_URL_ENDPOINT) {
    return null;
  }

  if (!imagekitInstance) {
    imagekitInstance = new ImageKit({
      publicKey: env.IMAGEKIT_PUBLIC_KEY,
      privateKey: env.IMAGEKIT_PRIVATE_KEY,
      urlEndpoint: env.IMAGEKIT_URL_ENDPOINT,
    });
  }

  return imagekitInstance;
}

/**
 * Generates short-lived client upload auth parameters ({ token, expire, signature }).
 * Strictly reserved for Admin uploads; private key never leaves the Express server.
 */
export function getImageKitAuthParams() {
  const ik = getImageKit();
  if (!ik) {
    throw new Error("ImageKit credentials are not configured in environment variables.");
  }
  return ik.getAuthenticationParameters();
}

/**
 * Uploads a validated customer review image buffer strictly into /divara/reviews.
 */
export async function uploadReviewImageBuffer({ buffer, ext }) {
  const ik = getImageKit();
  if (!ik) {
    throw new Error("ImageKit credentials are not configured in environment variables.");
  }

  const fileName = `review_${Date.now()}_${crypto.randomBytes(6).toString("hex")}.${ext}`;
  const uploaded = await ik.upload({
    file: buffer,
    fileName,
    folder: "/divara/reviews",
    useUniqueFileName: true,
  });

  const base = env.IMAGEKIT_URL_ENDPOINT.replace(/\/$/, "");
  return {
    url: uploaded.url || `${base}${uploaded.filePath}`,
    fileId: uploaded.fileId,
  };
}

/**
 * Deletes an orphaned or replaced media file from ImageKit when updated in the Admin Panel.
 */
export async function deleteImageKitFile(fileId) {
  if (!fileId) return;
  const ik = getImageKit();
  if (!ik) return;

  try {
    await ik.deleteFile(fileId);
  } catch (error) {
    console.warn(`[ImageKit] Failed to delete fileId=${fileId}:`, error.message);
  }
}