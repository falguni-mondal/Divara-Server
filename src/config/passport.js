import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "./env.js";
import { User } from "../models/User.js";

/**
 * Configures stateless Passport.js Google OAuth 2.0 strategy (session: false).
 * Links existing email accounts automatically or creates a new DIVARA customer profile.
 */
export function configurePassport() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn("[Passport] Google OAuth credentials not set; /auth/google routes disabled.");
    return passport;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value?.toLowerCase().trim();
          if (!email) {
            return done(new Error("Google account did not provide an email address"), null);
          }

          const fullName = profile.displayName?.trim() || "";
          const avatarUrl = profile.photos?.[0]?.value || "";

          let user = await User.findOne({
            $or: [{ googleId: profile.id }, { email }],
          });

          if (user) {
            if (!user.googleId) user.googleId = profile.id;
            if (!user.fullName && fullName) user.fullName = fullName;
            if (!user.avatarUrl && avatarUrl) user.avatarUrl = avatarUrl;
            user.lastLoginAt = new Date();
            await user.save();
          } else {
            user = await User.create({
              email,
              fullName,
              avatarUrl,
              googleId: profile.id,
              authProvider: "google",
              lastLoginAt: new Date(),
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error, null);
        }
      }
    )
  );

  return passport;
}