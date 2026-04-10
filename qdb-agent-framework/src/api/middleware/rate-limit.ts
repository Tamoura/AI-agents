/**
 * Rate Limit Middleware — Per-IP request rate limiting.
 */

import { type Context, type Next } from "hono";

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const limits = new Map<string, RateLimitEntry>();

export function rateLimit(maxRequests: number = 60, windowMs: number = 60_000) {
  return async (c: Context, next: Next) => {
    const ip = c.req.header("x-forwarded-for") ?? "unknown";
    const now = Date.now();
    const entry = limits.get(ip);

    if (!entry || now - entry.windowStart > windowMs) {
      limits.set(ip, { count: 1, windowStart: now });
      return next();
    }

    if (entry.count >= maxRequests) {
      return c.json(
        { error: "Rate limit exceeded. Please try again later." },
        429,
      );
    }

    entry.count++;
    return next();
  };
}
