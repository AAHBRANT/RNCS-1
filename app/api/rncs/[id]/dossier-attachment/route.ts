import { and, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { emailEvents, outlookConnections, rncs, works } from "../../../../../db/schema";
import { canAccessType, forbidden, sessionFromRequest, unauthorized } from "../../../../../lib/access-control";
import { encryptToken, refreshAccessToken } from "../../../../../lib/outlook-auth";
import { graph } from "../../../../../lib/outlook-sync";

type AuditAttachment = { id: string; name: string };

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    const { id } = await context.params;
    const rncId = Number(id);
    if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });

    const url = new URL(request.url);
    const eventId = Number(url.searchParams.get("eventId"));
    const attachmentId = url.searchParams.get("attachmentId") || "";
    if (!eventId || !attachmentId) return Response.json({ error: "Parâmetros inválidos." }, { status: 400 });

    await ensureDatabase();
    const db = getDb();
    const [rnc] = await db.select({ id: rncs.id, type: rncs.type })
      .from(rncs).innerJoin(works, eq(rncs.workId, works.id)).where(eq(rncs.id, rncId)).limit(1);
    if (!rnc) return Response.json({ error: "RNC não encontrada." }, { status: 404 });
    if (!canAccessType(session, rnc.type)) return forbidden("Esta RNC pertence a uma disciplina não autorizada para você.");

    const [event] = await db.select().from(emailEvents)
      .where(and(eq(emailEvents.id, eventId), eq(emailEvents.rncId, rncId))).limit(1);
    if (!event) return Response.json({ error: "Documento não encontrado no dossiê desta RNC." }, { status: 404 });

    let attachments: AuditAttachment[] = [];
    try {
      attachments = JSON.parse(event.attachmentMetadata || "[]");
    } catch {
      attachments = [];
    }
    const attachment = attachments.find((item) => item.id === attachmentId);
    if (!attachment || !/\.pdf$/i.test(attachment.name)) {
      return Response.json({ error: "Anexo não encontrado ou não é um PDF." }, { status: 404 });
    }

    const [connection] = await db.select().from(outlookConnections).limit(1);
    if (!connection) return Response.json({ error: "Conecte primeiro a conta do Outlook." }, { status: 400 });
    const token = await refreshAccessToken(connection.encryptedRefreshToken);
    if (token.refresh_token) {
      await db.update(outlookConnections).set({ encryptedRefreshToken: encryptToken(token.refresh_token) })
        .where(eq(outlookConnections.id, connection.id));
    }

    const detail = await graph<{ contentBytes?: string }>(
      token.access_token!,
      `/me/messages/${encodeURIComponent(event.outlookMessageId)}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    if (!detail.contentBytes) return Response.json({ error: "Não foi possível obter o conteúdo do PDF." }, { status: 502 });

    const buffer = Buffer.from(detail.contentBytes, "base64");
    return new Response(buffer, {
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${attachment.name.replace(/"/g, "")}"`,
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao carregar o PDF." }, { status: 500 });
  }
}
