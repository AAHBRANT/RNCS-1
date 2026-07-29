import { synchronizeOutlook } from "../../../../../lib/outlook-sync";
import { canEditRnc, forbidden, sessionFromRequest, unauthorized } from "../../../../../lib/access-control";
import { enforceRateLimit } from "../../../../../lib/rate-limit";

export const maxDuration = 300;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    if (!canEditRnc(session)) return forbidden("Somente a administradora pode reprocessar uma RNC.");
    const { id } = await context.params;
    const rncId = Number(id);
    if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });
    const body = await request.json().catch(() => ({})) as { cursor?: string };
    if (!body.cursor) {
      const limited = await enforceRateLimit(request, {
        scope: `rnc-reprocess-${rncId}`,
        limit: 5,
        windowSeconds: 600,
        identity: session.email,
      });
      if (limited) return limited;
    }
    return Response.json(await synchronizeOutlook({ force: true, targetRncId: rncId, cursor: body.cursor }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao reprocessar a RNC." }, { status: 500 });
  }
}
