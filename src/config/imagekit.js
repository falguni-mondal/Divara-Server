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
 * Private key never leaves the Express server.
 */
export function getImageKitAuthParams() {
  const ik = getImageKit();
  if (!ik) {
    throw new Error("ImageKit credentials are not configured in environment variables.");
  }
  return ik.getAuthenticationParameters();
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