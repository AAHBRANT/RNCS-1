import { synchronizeOutlook } from "../../../../lib/outlook-sync";
import { canEditRnc, forbidden, sessionFromRequest, unauthorized } from "../../../../lib/access-control";
import { enforceRateLimit } from "../../../../lib/rate-limit";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    if (!canEditRnc(session)) return forbidden("Somente a administradora pode atualizar os e-mails.");
    const body = await request.json().catch(() => ({})) as { cursor?: string; diagnostics?: boolean };
    if (!body.cursor) {
      const limited = await enforceRateLimit(request, {
        scope: "outlook-sync",
        limit: 5,
        windowSeconds: 300,
        identity: session.email,
      });
      if (limited) return limited;
    }
    return Response.json(await synchronizeOutlook({ force: true, cursor: body.cursor, diagnostics: body.diagnostics === true }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao atualizar e-mails." }, { status: 500 });
  }
}
