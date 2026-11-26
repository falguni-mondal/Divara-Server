import { describe, test, expect, vi, afterEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { createApp } from "../src/app.js";
import { env } from "../src/config/env.js";
import { User } from "../src/models/User.js";
import { COOKIE_NAMES } from "../src/middlewares/auth.middleware.js";

const app = createApp();
const VALID_ORIGIN = new URL(env.CLIENT_ORIGIN).origin;

function makeAccessCookie({ id = "507f1f77bcf86cd799439011", role = "customer", email = "user@test.com", tv = 0 } = {}) {
  const token = jwt.sign({ sub: id, role, email, tv }, env.JWT_ACCESS_SECRET, { expiresIn: "15m" });
  return `${COOKIE_NAMES.ACCESS}=${token}`;
}

function mockDbUser(userDoc) {
  return vi.spyOn(User, "findById").mockReturnValue({
    select: () => ({
      lean: async () => userDoc,
    }),
  });
}

describe("DIVARA Backend Security Controls", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("blocks cross-origin POST requests with 403 CSRF_ORIGIN_MISMATCH", async () => {
    const res = await request(app)
      .post("/api/v1/bag/items")
      .set("Origin", "https://evil-site.example")
      .send({ productId: "abc", size: "M", quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("CSRF_ORIGIN_MISMATCH");
  });

  test("blocks unauthenticated requests to /api/v1/admin/overview with 401", async () => {
    const res = await request(app).get("/api/v1/admin/overview");
    expect(res.status).toBe(401);
  });

  test("blocks signed-in customers from /api/v1/admin/overview with 403", async () => {
    mockDbUser({ _id: "507f1f77bcf86cd799439011", role: "customer", email: "user@test.com", isActive: true, tokenVersion: 0 });

    const res = await request(app)
      .get("/api/v1/admin/overview")
      .set("Cookie", [makeAccessCookie({ role: "customer", tv: 0 })]);

    expect(res.status).toBe(403);
  });

  test("immediately rejects access JWT when user tokenVersion has been incremented (Revoke Sessions)", async () => {
    mockDbUser({ _id: "507f1f77bcf86cd799439011", role: "customer", email: "user@test.com", isActive: true, tokenVersion: 1 });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Cookie", [makeAccessCookie({ role: "customer", tv: 0 })]);

    expect(res.status).toBe(401);
  });

  test("enforces AI admin air-gap by blocking admin roles on /api/v1/ai/chat", async () => {
    mockDbUser({ _id: "507f1f77bcf86cd799439012", role: "admin", email: "admin@test.com", isActive: true, tokenVersion: 0 });

    const res = await request(app)
      .post("/api/v1/ai/chat")
      .set("Origin", VALID_ORIGIN)
      .set("Cookie", [makeAccessCookie({ id: "507f1f77bcf86cd799439012", role: "admin", email: "admin@test.com", tv: 0 })])
      .send({ message: "hello" });

    expect(res.status).toBe(403);
    expect(res.body?.error?.code).toBe("STOREFRONT_ONLY");
  });

  test("rejects fake text bytes disguised as image/jpeg on POST /api/v1/media/review-upload", async () => {
    mockDbUser({ _id: "507f1f77bcf86cd799439011", role: "customer", email: "user@test.com", isActive: true, tokenVersion: 0 });

    const res = await request(app)
      .post("/api/v1/media/review-upload")
      .set("Origin", VALID_ORIGIN)
      .set("Cookie", [makeAccessCookie({ role: "customer", tv: 0 })])
      .set("Content-Type", "image/jpeg")
      .send(Buffer.from("this is not a real jpeg image file"));

    expect(res.status).toBe(400);
    expect(res.body?.error?.message).toMatch(/Only JPEG, PNG, and WebP/i);
  });
});