import { eq, sql } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { accessUsers } from "../db/schema";
import { decryptToken, encryptToken } from "./outlook-auth";

export const SESSION_COOKIE = "rnc_session";
export type AccessRole = "admin" | "drafter" | "reviewer_approver";
export type AccessSession = {
  id: number;
  name: string;
  email: string;
  role: AccessRole;
  allowedTypes: string[];
  allowedWorks: string[];
  activeWorkId: number | null;
  canViewAll: boolean;
  expiresAt: number;
};

export function accessControlEnabled() {
  return process.env.ACCESS_CONTROL_ENABLED === "true";
}

const setupSession: AccessSession = {
  id: 0,
  name: "Configuração inicial",
  email: "",
  role: "admin",
  allowedTypes: ["*"],
  allowedWorks: ["*"],
  activeWorkId: null,
  canViewAll: true,
  expiresAt: Number.MAX_SAFE_INTEGER,
};

export async function accessUserByEmail(email: string) {
  await ensureDatabase();
  const normalized = email.trim().toLowerCase();
  const localPart = normalized.split("@")[0];
  const [user] = await getDb().select().from(accessUsers)
    .where(
      normalized.includes("@")
        ? sql`LOWER(${accessUsers.email}) = ${normalized} OR SPLIT_PART(LOWER(${accessUsers.email}), '@', 1) = ${localPart}`
        : eq(accessUsers.email, normalized),
    ).limit(1);
  return user?.active ? user : null;
}

export function createSession(user: typeof accessUsers.$inferSelect) {
  const session: AccessSession = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as AccessRole,
    allowedTypes: JSON.parse(user.allowedTypes || "[]"),
    allowedWorks: JSON.parse(user.allowedWorks || "[]"),
    activeWorkId: null,
    canViewAll: user.canViewAll,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
  };
  return encryptToken(JSON.stringify(session));
}

export function parseSession(value?: string | null): AccessSession | null {
  if (!value) return null;
  try {
    const session = JSON.parse(decryptToken(value)) as AccessSession;
    if (!session.email || !session.role || session.expiresAt < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  for (const item of cookie.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

export function sessionFromRequest(request: Request) {
  if (!accessControlEnabled()) return setupSession;
  return parseSession(cookieValue(request, SESSION_COOKIE));
}

function normalizeType(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function canAccessType(session: AccessSession, type: string) {
  if (session.role === "admin" || session.canViewAll || session.allowedTypes.includes("*")) {
    return true;
  }
  const normalizedType = normalizeType(type);
  return session.allowedTypes.some((allowed) => normalizeType(allowed) === normalizedType);
}

export function canAccessWork(session: AccessSession, workId: number) {
  if (session.role === "admin" || session.allowedWorks.includes("*")) {
    return true;
  }
  return session.allowedWorks.includes(String(workId));
}

export function withActiveWork(session: AccessSession, workId: number) {
  return encryptToken(JSON.stringify({ ...session, activeWorkId: workId }));
}

export function sessionFromCookieStore(cookieStore: { get(name: string): { value: string } | undefined }) {
  if (!accessControlEnabled()) return setupSession;
  return parseSession(cookieStore.get(SESSION_COOKIE)?.value);
}

export function canEditRnc(session: AccessSession) {
  return session.role === "admin";
}

// Permissão específica do Planner (equivale a CAN_ADJUST_PLANNER_DEADLINE): confirmar interpretação,
// ajustar datas/dependências e concluir compromissos. Redatores apenas visualizam.
export function canAdjustPlannerDeadline(session: AccessSession) {
  return session.role === "admin" || session.role === "reviewer_approver";
}

export function canSaveResponseStatus(session: AccessSession, status: string) {
  if (session.role === "admin" || session.role === "reviewer_approver") {
    return ["Rascunho", "Em revisão", "Documento aprovado"].includes(status);
  }
  return session.role === "drafter" && ["Rascunho", "Em revisão"].includes(status);
}

export function unauthorized() {
  return Response.json({ error: "Identifique-se com a conta Microsoft autorizada." }, { status: 401 });
}

export function forbidden(message = "Você não tem permissão para esta operação.") {
  return Response.json({ error: message }, { status: 403 });
}
