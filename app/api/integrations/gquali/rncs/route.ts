import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { rncs } from "../../../../../db/schema";
import { authorizeGquali } from "../../../../../lib/gquali-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

// Full reconciliation on each cycle; ID pagination avoids relying on all legacy
// mutation paths correctly maintaining updatedAt. No messages or tokens exported.
export async function GET(request: Request) {
  const workIds = authorizeGquali(request);
  if (!workIds) return Response.json({ error: "Integração não autorizada." }, { status: 401, headers });
  const cursor = new URL(request.url).searchParams.get("afterId") || "0";
  if (!/^\d+$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
    return Response.json({ error: "Cursor inválido." }, { status: 400, headers });
  }
  try {
    const rows = await getDb().select({
      id: rncs.id, workId: rncs.workId, number: rncs.number, year: rncs.year,
      description: rncs.description, type: rncs.type, serviceLocation: rncs.serviceLocation,
      receivedAt: rncs.receivedAt, dueAt: rncs.dueAt, sentAt: rncs.sentAt,
      returnedAt: rncs.returnedAt, status: rncs.status, updatedAt: rncs.updatedAt,
    }).from(rncs).where(and(inArray(rncs.workId, workIds), eq(rncs.type, "Engenharia"), gt(rncs.id, Number(cursor))))
      .orderBy(asc(rncs.id)).limit(101);
    const items = rows.slice(0, 100);
    return Response.json({ schemaVersion: 1, source: "RNCS-1", items,
      nextCursor: rows.length > 100 ? String(items[items.length - 1].id) : null,
    }, { headers });
  } catch {
    return Response.json({ error: "Não foi possível consultar as RNCs." }, { status: 503, headers });
  }
}
