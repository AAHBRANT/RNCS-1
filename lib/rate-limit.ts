import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { apiRateLimits } from "../db/schema";

type RateLimitOptions = {
  scope: string;
  limit: number;
  windowSeconds: number;
  identity?: string;
};

function requestIdentity(request: Request, explicit?: string) {
  if (explicit) return explicit.trim().toLowerCase();
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  const agent = request.headers.get("user-agent") || "unknown";
  return `${ip}|${agent}`;
}

export async function enforceRateLimit(request: Request, options: RateLimitOptions) {
  const fingerprint = createHash("sha256")
    .update(requestIdentity(request, options.identity))
    .digest("hex")
    .slice(0, 24);
  const key = `${options.scope}:${fingerprint}`;
  const now = new Date();
  const cutoff = new Date(now.getTime() - options.windowSeconds * 1000).toISOString();
  const expiresAt = new Date(now.getTime() + options.windowSeconds * 1000).toISOString();
  const nowValue = now.toISOString();

  await ensureDatabase();
  const [result] = await getDb().insert(apiRateLimits).values({
    key,
    count: 1,
    windowStart: nowValue,
    expiresAt,
  }).onConflictDoUpdate({
    target: apiRateLimits.key,
    set: {
      count: sql`CASE WHEN ${apiRateLimits.windowStart} <= ${cutoff}::timestamptz THEN 1 ELSE ${apiRateLimits.count} + 1 END`,
      windowStart: sql`CASE WHEN ${apiRateLimits.windowStart} <= ${cutoff}::timestamptz THEN ${nowValue}::timestamptz ELSE ${apiRateLimits.windowStart} END`,
      expiresAt: sql`CASE WHEN ${apiRateLimits.windowStart} <= ${cutoff}::timestamptz THEN ${expiresAt}::timestamptz ELSE ${apiRateLimits.expiresAt} END`,
    },
  }).returning();

  if (result.count <= options.limit) return null;
  const resetAt = new Date(result.windowStart).getTime() + options.windowSeconds * 1000;
  const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
  return Response.json({
    error: `Muitas solicitações em pouco tempo. Aguarde ${retryAfter} segundos e tente novamente.`,
    retryAfter,
  }, {
    status: 429,
    headers: {
      "retry-after": String(retryAfter),
      "x-ratelimit-limit": String(options.limit),
      "x-ratelimit-remaining": "0",
      "cache-control": "no-store",
    },
  });
}
