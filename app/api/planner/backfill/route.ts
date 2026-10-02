import { accessibleRncs, plannerContext, plannerErrorResponse } from "../../../../lib/planner-api";
import { reconcileAll } from "../../../../lib/planner-service";

// Analisa os PAMs já existentes e popula o Planner usando a data real de envio (e-mail enviado), nunca a data de importação.
export async function POST(request: Request) {
  try {
    const context = await plannerContext(request, { requireAdjust: true });
    if ("error" in context) return context.error;
    const { session, db } = context;
    const visible = await accessibleRncs(db, session);
    const result = await reconcileAll(db, visible.map((rnc) => rnc.id));
    return Response.json(result);
  } catch (error) {
    return plannerErrorResponse(error);
  }
}
