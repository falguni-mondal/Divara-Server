import crypto from "crypto";
import bcrypt from "bcryptjs";
import { User } from "../models/User.js";
import { AuthOtp } from "../models/AuthOtp.js";
import { Job } from "../models/Job.js";
import { env } from "../config/env.js";
import { sendEmail } from "../config/resend.js";
import { ApiError } from "../utils/apiError.js";
import { sendSuccess } from "../utils/apiResponse.js";
import { ADMIN_ROLES, getCookieOptions } from "../middlewares/auth.middleware.js";
import { logAdminAction } from "../utils/auditLogger.js";
import { appCache } from "../utils/lruCache.js";
import {
  generateTotpSecret,
  verifyTotpCode,
  buildOtpAuthUri,
} from "../utils/totp.js";
import {
  issueAuthSession,
  rotateRefreshToken,
  revokeCurrentSession,
} from "../services/auth.service.js";

const TOTP_CHALLENGE_COOKIE = "divara_totp_challenge";
const TOTP_CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TOTP_MAX_ATTEMPTS = 5;

function sha256(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function signTotpChallenge({ userId, email }) {
  const exp = Date.now() + TOTP_CHALLENGE_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ sub: String(userId), email, exp })).toString("base64url");
  const sig = crypto
    .createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

function verifyTotpChallengeCookie(cookieVal, expectedEmail) {
  if (!cookieVal || typeof cookieVal !== "string") return null;
  const parts = cookieVal.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expectedSig = crypto
    .createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(payload)
    .digest("base64url");

  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    if (parsed.email !== expectedEmail) return null;
    return parsed;
  } catch {
    return null;
  }
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local.slice(0, Math.min(3, local.length))}***@${domain}`;
}

async function sendOtpEmail({ to, otpCode, heading, note }) {
  await sendEmail({
    to,
    subject: `${otpCode} is your DIVARA Verification Code`,
    html: `
      <div style="background:#f8f6f4;padding:32px 16px;font-family:Georgia,serif;color:#1b1717;">
        <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e6e2de;padding:32px;">
          <div style="font-size:20px;letter-spacing:0.26em;color:#1b1717;border-bottom:2px solid #5d100a;padding-bottom:12px;">DIVARA</div>
          <p style="font-family:Arial,sans-serif;font-size:13.5px;margin-top:20px;">${heading}</p>
          <div style="margin:24px 0;padding:18px;background:#f8f6f4;border-left:4px solid #5d100a;text-align:center;font-family:monospace;font-size:30px;letter-spacing:0.35em;font-weight:700;color:#5d100a;">
            ${otpCode}
          </div>
          <p style="font-family:Arial,sans-serif;font-size:12px;color:#5a5353;">${note} This code expires in <strong>10 minutes</strong>.</p>
        </div>
      </div>
    `,
  });
}

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

  const user = await User.findOne({ email }).select("+passwordHash +totpSecret");

  if (!user) {
    const otpCode = String(crypto.randomInt(100000, 999999));
    const passwordHash = await bcrypt.hash(password, 12);

    await AuthOtp.deleteMany({ email, purpose: "CUSTOMER_REGISTER" });
    await AuthOtp.create({
      purpose: "CUSTOMER_REGISTER",
      email,
      sentToEmail: email,
      pendingFullName: fullName?.trim() || email.split("@")[0],
      pendingPasswordHash: passwordHash,
      otpHash: sha256(otpCode),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendOtpEmail({
      to: email,
      otpCode,
      heading: "Verify your email address to create your DIVARA Atelier account:",
      note: "Enter this code on divara.byfalguni.com to complete your registration.",
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: `Verification OTP sent to ${maskEmail(email)}.`,
      data: {
        verificationType: "EMAIL_OTP",
        purpose: "CUSTOMER_REGISTER",
        email,
        maskedTarget: maskEmail(email),
      },
    });
  }

  const isAdminAccount = ADMIN_ROLES.has(user.role);

  if (!user.isActive) {
    if (isAdminAccount) {
      await logAdminAction(req, {
        actor: user,
        action: "ADMIN_LOGIN_FAILED",
        status: "FAILED",
        summary: `Disabled admin account ${user.email} attempted login.`,
      });
    }
    throw ApiError.forbidden("This account has been deactivated.");
  }

  if (!user.passwordHash && user.authProvider === "google") {
    throw ApiError.badRequest(
      "This email is linked to Google Sign-In. Please click 'Continue with Google'."
    );
  }

  const valid = await user.verifyPassword(password);
  if (!valid) {
    if (isAdminAccount) {
      await logAdminAction(req, {
        actor: user,
        action: "ADMIN_LOGIN_FAILED",
        status: "FAILED",
        summary: `Failed password login attempt for ${user.email}.`,
      });
    }
    throw ApiError.unauthorized("Incorrect email or password");
  }

  if (user.role === "super_admin") {
    let secret = user.totpSecret;
    const needsTotpSetup = !user.totpEnabled || !secret;

    if (!secret) {
      secret = generateTotpSecret();
      user.totpSecret = secret;
      user.totpEnabled = false;
      await user.save();
    }

    // Bind TOTP verification strictly to this password-verified challenge cookie
    const challengeToken = signTotpChallenge({ userId: user._id, email: user.email });
    res.cookie(TOTP_CHALLENGE_COOKIE, challengeToken, getCookieOptions(TOTP_CHALLENGE_TTL_MS));

    await logAdminAction(req, {
      actor: user,
      action: "SUPER_ADMIN_TOTP_CHALLENGE",
      status: "SUCCESS",
      summary: `TOTP authenticator challenge issued for ${user.email}.`,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: needsTotpSetup
        ? "Scan the QR code in Microsoft / Google Authenticator and enter the 6-digit code."
        : "Enter the 6-digit code from your Authenticator app.",
      data: {
        verificationType: "TOTP",
        email: user.email,
        needsTotpSetup,
        ...(needsTotpSetup
          ? {
              manualSecret: secret,
              otpauthUrl: buildOtpAuthUri({ email: user.email, secret }),
            }
          : {}),
      },
    });
  }

  if (user.role === "admin") {
    const otpCode = String(crypto.randomInt(100000, 999999));
    const targetEmail = user.notificationEmail || user.email;

    await AuthOtp.deleteMany({ userId: user._id, purpose: "ADMIN_LOGIN" });
    await AuthOtp.create({
      purpose: "ADMIN_LOGIN",
      email: user.email,
      sentToEmail: targetEmail,
      userId: user._id,
      otpHash: sha256(otpCode),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    await sendOtpEmail({
      to: targetEmail,
      otpCode,
      heading: `Admin login verification requested for <strong>${user.email}</strong>:`,
      note: `IP: ${req.ip || "Unknown"}.`,
    });

    await logAdminAction(req, {
      actor: user,
      action: "ADMIN_OTP_SENT",
      status: "SUCCESS",
      summary: `2FA login OTP sent to ${maskEmail(targetEmail)} for ${user.email}.`,
    });

    return sendSuccess(res, {
      statusCode: 200,
      message: `Login OTP sent to ${maskEmail(targetEmail)}.`,
      data: {
        verificationType: "EMAIL_OTP",
        purpose: "ADMIN_LOGIN",
        email: user.email,
        maskedTarget: maskEmail(targetEmail),
      },
    });
  }

  user.lastLoginAt = new Date();
  await user.save();
  const profile = await issueAuthSession(req, res, user);

  return sendSuccess(res, {
    statusCode: 200,
    message: "Signed in successfully",
    data: { verificationType: "NONE", user: profile },
  });
}

export async function requestSuperAdminEmailOtp(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const password = req.body.password;

  const user = await User.findOne({ email, role: "super_admin" }).select("+passwordHash");
  if (!user || !user.isActive) {
    throw ApiError.unauthorized("Invalid Super Admin request");
  }

  const valid = await user.verifyPassword(password);
  if (!valid) {
    throw ApiError.unauthorized("Session expired. Please sign in again.");
  }

  const otpCode = String(crypto.randomInt(100000, 999999));
  const targetEmail = user.notificationEmail || env.ADMIN_NOTIFICATION_EMAIL;

  await AuthOtp.deleteMany({ userId: user._id, purpose: "ADMIN_LOGIN" });
  await AuthOtp.create({
    purpose: "ADMIN_LOGIN",
    email: user.email,
    sentToEmail: targetEmail,
    userId: user._id,
    otpHash: sha256(otpCode),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  await sendOtpEmail({
    to: targetEmail,
    otpCode,
    heading: `Super Admin Email OTP fallback requested for <strong>${user.email}</strong>:`,
    note: `IP: ${req.ip || "Unknown"}.`,
  });

  await logAdminAction(req, {
    actor: user,
    action: "SUPER_ADMIN_EMAIL_OTP_FALLBACK",
    status: "SUCCESS",
    summary: `Super Admin requested Email OTP fallback to ${maskEmail(targetEmail)}.`,
  });

  return sendSuccess(res, {
    message: `Fallback OTP sent to ${maskEmail(targetEmail)}.`,
    data: {
      purpose: "ADMIN_LOGIN",
      maskedTarget: maskEmail(targetEmail),
    },
  });
}

export async function verifyEmailOtp(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const otp = req.body.otp.trim();
  const purpose = req.body.purpose;

  const record = await AuthOtp.findOne({
    email,
    purpose,
    isUsed: false,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!record) {
    if (purpose === "ADMIN_LOGIN") {
      await logAdminAction(req, {
        actorEmail: email,
        actorRole: "admin",
        action: "ADMIN_OTP_FAILED",
        status: "FAILED",
        summary: `Expired or missing OTP attempt for ${email}.`,
      });
    }
    throw ApiError.unauthorized("Verification code expired. Please try again.");
  }

  if (record.attempts >= 5) {
    await AuthOtp.updateOne({ _id: record._id }, { $set: { isUsed: true } });
    throw ApiError.unauthorized("Too many invalid attempts. Please request a new code.");
  }

  if (record.otpHash !== sha256(otp)) {
    const updated = await AuthOtp.findByIdAndUpdate(
      record._id,
      { $inc: { attempts: 1 } },
      { returnDocument: "after" }
    );
    if (purpose === "ADMIN_LOGIN") {
      await logAdminAction(req, {
        actorEmail: email,
        actorRole: "admin",
        action: "ADMIN_OTP_FAILED",
        status: "FAILED",
        summary: `Invalid OTP entered for ${email} (attempt ${updated?.attempts || record.attempts + 1}/5).`,
      });
    }
    throw ApiError.unauthorized("Invalid verification code. Please try again.");
  }

  // Atomic claim prevents concurrent replay of the same OTP
  const claimed = await AuthOtp.findOneAndUpdate(
    { _id: record._id, isUsed: false },
    { $set: { isUsed: true } },
    { returnDocument: "after" }
  );

  if (!claimed) {
    throw ApiError.unauthorized("Verification code already used. Please request a new code.");
  }

  let user;
  if (purpose === "CUSTOMER_REGISTER") {
    const existing = await User.findOne({ email: claimed.email });
    if (existing) {
      throw ApiError.conflict("An account with this email already exists. Please sign in.");
    }

    user = await User.create({
      email: claimed.email,
      fullName: claimed.pendingFullName,
      passwordHash: claimed.pendingPasswordHash,
      authProvider: "local",
      role: "customer",
      lastLoginAt: new Date(),
    });

    await Job.create({
      type: "SEND_WELCOME_EMAIL",
      idempotencyKey: `welcome-${user._id}`,
      payload: { email: user.email, fullName: user.fullName },
    });
  } else {
    user = await User.findById(claimed.userId);
    if (!user || !user.isActive || !ADMIN_ROLES.has(user.role)) {
      throw ApiError.unauthorized("Admin account unavailable");
    }
    user.lastLoginAt = new Date();
    await user.save();

    await logAdminAction(req, {
      actor: user,
      action: "ADMIN_LOGIN_SUCCESS",
      status: "SUCCESS",
      summary: `${user.email} (${user.role}) completed Email OTP login.`,
    });
  }

  const profile = await issueAuthSession(req, res, user);

  return sendSuccess(res, {
    statusCode: 200,
    message:
      purpose === "CUSTOMER_REGISTER"
        ? "Account verified and created."
        : "Admin verification successful.",
    data: { user: profile },
  });
}

export async function verifySuperAdminTotp(req, res) {
  const email = req.body.email.toLowerCase().trim();
  const code = req.body.code.trim();

  // Enforce password-first challenge cookie
  const challenge = verifyTotpChallengeCookie(req.cookies?.[TOTP_CHALLENGE_COOKIE], email);
  if (!challenge) {
    throw ApiError.unauthorized("Authentication challenge expired. Please enter your password again.");
  }

  const user = await User.findOne({ _id: challenge.sub, email, role: "super_admin" }).select("+totpSecret");
  if (!user || !user.isActive || !user.totpSecret) {
    throw ApiError.unauthorized("Invalid Super Admin TOTP request");
  }

  const attemptsKey = `totp_attempts:${user._id}`;
  const failedAttempts = appCache.get(attemptsKey) || 0;
  if (failedAttempts >= TOTP_MAX_ATTEMPTS) {
    res.clearCookie(TOTP_CHALLENGE_COOKIE, getCookieOptions(0));
    throw ApiError.tooManyRequests("Too many failed authenticator attempts. Please wait 10 minutes.");
  }

  const replayKey = `totp_used:${user._id}:${code}`;
  if (appCache.get(replayKey)) {
    throw ApiError.unauthorized("This authenticator code was already used. Wait for the next 30-second code.");
  }

  const valid = verifyTotpCode(user.totpSecret, code, 1);
  if (!valid) {
    appCache.set(attemptsKey, failedAttempts + 1, 10 * 60 * 1000);
    await logAdminAction(req, {
      actor: user,
      action: "SUPER_ADMIN_TOTP_FAILED",
      status: "FAILED",
      summary: `Invalid TOTP authenticator code entered for ${user.email} (attempt ${failedAttempts + 1}/${TOTP_MAX_ATTEMPTS}).`,
    });
    throw ApiError.unauthorized("Invalid 6-digit authenticator code.");
  }

  // Mark code used for 95s (covers ±1 TOTP step window) & clear challenge cookie
  appCache.set(replayKey, true, 95 * 1000);
  appCache.delete(attemptsKey);
  res.clearCookie(TOTP_CHALLENGE_COOKIE, getCookieOptions(0));

  if (!user.totpEnabled) {
    user.totpEnabled = true;
  }
  user.lastLoginAt = new Date();
  await user.save();

  const profile = await issueAuthSession(req, res, user);

  await logAdminAction(req, {
    actor: user,
    action: "ADMIN_LOGIN_SUCCESS",
    status: "SUCCESS",
    summary: `Super Admin ${user.email} completed TOTP authenticator login.`,
  });

  return sendSuccess(res, {
    statusCode: 200,
    message: "Super Admin authenticated.",
    data: { user: profile },
  });
}

export async function googleCallback(req, res) {
  if (!req.user || !req.user.isActive) {
    return res.redirect(`${env.CLIENT_ORIGIN}/account?auth=failed`);
  }
  if (ADMIN_ROLES.has(req.user.role)) {
    return res.redirect(`${env.CLIENT_ORIGIN}/account?auth=admin_2fa_required`);
  }
  await issueAuthSession(req, res, req.user);
  return res.redirect(`${env.CLIENT_ORIGIN}/account?auth=success`);
}

export async function refreshSession(req, res) {
  const user = await rotateRefreshToken(req, res);
  return sendSuccess(res, { data: { user } });
}

export async function logout(req, res) {
  if (req.user && ADMIN_ROLES.has(req.user.role)) {
    await logAdminAction(req, {
      actor: req.user,
      action: "ADMIN_LOGOUT",
      status: "SUCCESS",
      summary: `${req.user.email} signed out of the Admin Panel.`,
    });
  }
  res.clearCookie(TOTP_CHALLENGE_COOKIE, getCookieOptions(0));
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