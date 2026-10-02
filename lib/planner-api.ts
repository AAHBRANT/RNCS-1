import { eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { rncs, works } from "../db/schema";
import {
  canAccessType,
  canAccessWork,
  canAdjustPlannerDeadline,
  forbidden,
  sessionFromRequest,
  unauthorized,
  type AccessSession,
} from "./access-control";
import { PlannerError } from "./planner-service";

export type PlannerRnc = {
  id: number; number: string; year: number; description: string; type: string; status: string; workId: number; workName: string;
};

export async function plannerContext(request: Request, options: { requireAdjust?: boolean; requireAdmin?: boolean } = {}) {
  const session = sessionFromRequest(request);
  if (!session) return { error: unauthorized() };
  if (options.requireAdmin && session.role !== "admin") return { error: forbidden("Somente administradores podem alterar esta configuração.") };
  if (options.requireAdjust && !canAdjustPlannerDeadline(session)) {
    return { error: forbidden("Seu perfil pode visualizar o Planner, mas não pode alterar prazos nem conclusões.") };
  }
  await ensureDatabase();
  return { session, db: getDb() };
}

export function canSeeRnc(session: AccessSession, rnc: { type: string; workId: number }) {
  return canAccessType(session, rnc.type)
    && (session.activeWorkId === null || rnc.workId === session.activeWorkId)
    && canAccessWork(session, rnc.workId);
}

export async function accessibleRncs(db: ReturnType<typeof getDb>, session: AccessSession): Promise<PlannerRnc[]> {
  const rows = await db.select({
    id: rncs.id, number: rncs.number, year: rncs.year, description: rncs.description, type: rncs.type,
    status: rncs.status, workId: rncs.workId, workName: works.name,
  }).from(rncs).innerJoin(works, eq(rncs.workId, works.id));
  return rows.filter((rnc) => canSeeRnc(session, rnc));
}

export function plannerErrorResponse(error: unknown) {
  if (error instanceof PlannerError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Erro ao processar o Planner." }, { status: 500 });
}
