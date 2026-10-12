import { timingSafeEqual } from "node:crypto";

// Separate service credential. Never inherit the interactive setup/admin session.
export function authorizeGquali(request: Request, env: Record<string, string | undefined> = process.env): number[] | null {
  const token = env.GQUALI_READ_TOKEN || "";
  const configured = (env.GQUALI_WORK_IDS || "").split(",").map(value => value.trim());
  if (token.length < 32 || !configured.length || configured.some(value => !/^[1-9]\d*$/.test(value))) return null;
  const works = configured.map(Number);
  if (works.some(value => !Number.isSafeInteger(value))) return null;
  const provided = request.headers.get("authorization") || "";
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(provided);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return [...new Set(works)];
}
