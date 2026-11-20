import { User } from "../models/User.js";
import { env } from "../config/env.js";
import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  issueAuthSession,
  rotateRefreshToken,
  revokeCurrentSession,
} from "../services/auth.service.js";

export async function identifyEmail(req, res) {
  const start = Date.now();
  const email = req.body.email.toLowerCase().trim();
  const existing = await User.exists({ email });

  const elapsed = Date.now() - start;
  if (elapsed < 80) {
    await new Promise((r) => setTimeout(r, 80 - elapsed));
  }

  return sendSuccess(res, {
    data: {
      email,
      step: "signin",
      mode: existing ? "login" : "register",
    },
  });
}

export async function emailPasswordContinue(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const { password, fullName } = req.body;

  let user = await User.findOne({ email }).select("+passwordHash");

  if (user) {
    if (!user.passwordHash && user.authProvider === "google") {
      throw ApiError.badRequest(
        "This email is linked to Google Sign-In. Please click 'Continue with Google'."
      );
    }

    const valid = await user.verifyPassword(password);
    if (!valid) {
      throw ApiError.unauthorized("Incorrect email or password");
    }

    user.lastLoginAt = new Date();
    await user.save();
  } else {
    user = new User({
      email,
      fullName: fullName?.trim() || email.split("@")[0],
      authProvider: "local",
      lastLoginAt: new Date(),
    });
    await user.setPassword(password);
    await user.save();
  }

  const profile = await issueAuthSession(req, res, user);

  return sendSuccess(res, {
    statusCode: 200,
    message: "Signed in successfully",
    data: { user: profile },
  });
}

export async function googleCallback(req, res) {
  if (!req.user) {
    return res.redirect(`${env.CLIENT_ORIGIN}/account?auth=failed`);
  }

  await issueAuthSession(req, res, req.user);
  return res.redirect(`${env.CLIENT_ORIGIN}/account?auth=success`);
}

export async function refreshSession(req, res) {
  const user = await rotateRefreshToken(req, res);
  return sendSuccess(res, { data: { user } });
}

export async function logout(req, res) {
  await revokeCurrentSession(req, res);
  return sendSuccess(res, { message: "Signed out cleanly" });
}

export async function getMe(req, res) {
  return sendSuccess(res, {
    data: {
      user: {
        id: String(req.user._id),
        email: req.user.email,
        fullName: req.user.fullName,
        phone: req.user.phone,
        avatarUrl: req.user.avatarUrl,
        role: req.user.role,
        addresses: req.user.addresses || [],
      },
    },
  });
}