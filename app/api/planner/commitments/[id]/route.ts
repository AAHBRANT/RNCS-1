import { eq } from "drizzle-orm";
import { rncs } from "../../../../../db/schema";
import { plannerCommitments } from "../../../../../db/schema";
import { forbidden } from "../../../../../lib/access-control";
import { canSeeRnc, plannerContext, plannerErrorResponse } from "../../../../../lib/planner-api";
import {
  PlannerError,
  adjustCommitmentDue,
  completeCommitment,
  editCommitmentRule,
  reopenCommitment,
  setCommitmentMilestone,
} from "../../../../../lib/planner-service";
import { enforceRateLimit } from "../../../../../lib/rate-limit";

export async function PATCH(request: Request, routeContext: { params: Promise<{ id: string }> }) {
  try {
    const context = await plannerContext(request, { requireAdjust: true });
    if ("error" in context) return context.error;
    const { session, db } = context;
    const { id } = await routeContext.params;
    const commitmentId = Number(id);
    if (!commitmentId) return Response.json({ error: "Compromisso inválido." }, { status: 400 });

    const [row] = await db.select({ rncId: plannerCommitments.rncId }).from(plannerCommitments).where(eq(plannerCommitments.id, commitmentId)).limit(1);
    if (!row) throw new PlannerError("Compromisso não encontrado.", 404);
    const [rnc] = await db.select({ type: rncs.type, workId: rncs.workId }).from(rncs).where(eq(rncs.id, row.rncId)).limit(1);
    if (!rnc || !canSeeRnc(session, rnc)) return forbidden("Esta RNC não está disponível para o seu perfil.");

    const limited = await enforceRateLimit(request, { scope: "planner-edit", limit: 60, windowSeconds: 300, identity: session.email });
    if (limited) return limited;

    const body = await request.json() as Record<string, unknown>;
    const actor = { name: session.name, email: session.email };
    switch (body.action) {
      case "complete": await completeCommitment(db, commitmentId, actor, body.completedAt as string | undefined); break;
      case "reopen": await reopenCommitment(db, commitmentId, actor); break;
      case "adjust": await adjustCommitmentDue(db, commitmentId, actor, { date: body.date, reason: body.reason }); break;
      case "clear-adjust": await adjustCommitmentDue(db, commitmentId, actor, { reason: body.reason, clear: true }); break;
      case "milestone": await setCommitmentMilestone(db, commitmentId, actor, { date: body.date, reason: body.reason }); break;
      case "rule": await editCommitmentRule(db, commitmentId, actor, body as Parameters<typeof editCommitmentRule>[3]); break;
      default: throw new PlannerError("Ação desconhecida.");
    }
    return Response.json({ ok: true, rncId: row.rncId });
  } catch (error) {
    return plannerErrorResponse(error);
  }
}
