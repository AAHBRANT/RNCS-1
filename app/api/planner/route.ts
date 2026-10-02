import { inArray } from "drizzle-orm";
import { plannerCommitments, plannerPams } from "../../../db/schema";
import { canAdjustPlannerDeadline, accessControlEnabled } from "../../../lib/access-control";
import { accessibleRncs, plannerContext, plannerErrorResponse } from "../../../lib/planner-api";
import { getBands, reconcileAll, todayIsoInBrazil } from "../../../lib/planner-service";

export async function GET(request: Request) {
  try {
    const context = await plannerContext(request);
    if ("error" in context) return context.error;
    const { session, db } = context;

    const only = Number(new URL(request.url).searchParams.get("rncId")) || null;
    const visible = (await accessibleRncs(db, session)).filter((rnc) => !only || rnc.id === only);
    const ids = visible.map((rnc) => rnc.id);
    if (!ids.length) {
      return Response.json({ rncs: [], commitments: [], pams: [], bands: await getBands(db), canAdjust: canAdjustPlannerDeadline(session), today: todayIsoInBrazil(), user: accessControlEnabled() ? session : null });
    }

    // Liga PAMs aos e-mails de envio e analisa PAMs antigos; falha aqui não impede de ver o Planner.
    try { await reconcileAll(db, ids); } catch (error) { console.error("Planner: falha ao reconciliar PAMs", error); }

    const [commitments, pams, bands] = await Promise.all([
      db.select().from(plannerCommitments).where(inArray(plannerCommitments.rncId, ids)),
      db.select().from(plannerPams).where(inArray(plannerPams.rncId, ids)),
      getBands(db),
    ]);
    const withData = new Set([...commitments.map((row) => row.rncId), ...pams.map((pam) => pam.rncId)]);
    return Response.json({
      rncs: visible.filter((rnc) => withData.has(rnc.id)),
      commitments,
      pams,
      bands,
      canAdjust: canAdjustPlannerDeadline(session),
      today: todayIsoInBrazil(),
      user: accessControlEnabled() ? session : null,
    });
  } catch (error) {
    return plannerErrorResponse(error);
  }
}
