import { eq } from "drizzle-orm";
import { plannerPams, rncs } from "../../../../../db/schema";
import { forbidden } from "../../../../../lib/access-control";
import { canSeeRnc, plannerContext, plannerErrorResponse } from "../../../../../lib/planner-api";
import { PlannerError, confirmPam, setPamSentDate } from "../../../../../lib/planner-service";

export async function PATCH(request: Request, routeContext: { params: Promise<{ id: string }> }) {
  try {
    const context = await plannerContext(request, { requireAdjust: true });
    if ("error" in context) return context.error;
    const { session, db } = context;
    const { id } = await routeContext.params;
    const pamId = Number(id);
    if (!pamId) return Response.json({ error: "PAM inválido." }, { status: 400 });

    const [pam] = await db.select({ rncId: plannerPams.rncId }).from(plannerPams).where(eq(plannerPams.id, pamId)).limit(1);
    if (!pam) throw new PlannerError("PAM não encontrado no Planner.", 404);
    const [rnc] = await db.select({ type: rncs.type, workId: rncs.workId }).from(rncs).where(eq(rncs.id, pam.rncId)).limit(1);
    if (!rnc || !canSeeRnc(session, rnc)) return forbidden("Esta RNC não está disponível para o seu perfil.");

    const body = await request.json() as Record<string, unknown>;
    const actor = { name: session.name, email: session.email };
    if (body.action === "sent-date") await setPamSentDate(db, pamId, actor, { date: body.date, reason: body.reason });
    else if (body.action === "confirm") await confirmPam(db, pamId, actor);
    else throw new PlannerError("Ação desconhecida.");
    return Response.json({ ok: true, rncId: pam.rncId });
  } catch (error) {
    return plannerErrorResponse(error);
  }
}
