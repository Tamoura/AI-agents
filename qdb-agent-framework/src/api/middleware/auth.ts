/**
 * Authentication Middleware — API key validation for v1.
 * Production: swap for Azure AD / JWT validation.
 */

import { type Context, type Next } from "hono";

const API_KEY_HEADER = "x-api-key";

/**
 * Creates an API key auth middleware.
 * In v1, accepts any non-empty API key. For production, integrate Azure AD.
 */
export function apiKeyAuth() {
  return async (c: Context, next: Next) => {
    // Skip auth in development if no key configured
    if (process.env.NODE_ENV === "development") {
      return next();
    }

    const apiKey = c.req.header(API_KEY_HEADER);
    if (!apiKey) {
      return c.json({ error: "Missing API key. Provide x-api-key header." }, 401);
    }

    // V1: simple presence check. Production: validate against Azure AD.
    if (apiKey.length < 8) {
      return c.json({ error: "Invalid API key." }, 401);
    }

    return next();
  };
}
