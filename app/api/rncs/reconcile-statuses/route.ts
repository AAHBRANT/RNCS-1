import { asc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { emailEvents, rncs } from "../../../../db/schema";
import { analysisStatusFromEmailBody } from "../../../../lib/rnc-analysis";

function parsedJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function POST() {
  try {
    await ensureDatabase();
    const db = getDb();
    const events = await db.select().from(emailEvents)
      .where(eq(emailEvents.eventType, "retorno_supervisao"))
      .orderBy(asc(emailEvents.occurredAt));
    let updated = 0;
    for (const event of events) {
      const result = analysisStatusFromEmailBody(event.summary || "");
      if (!result) continue;
      const [record] = await db.select().from(rncs).where(eq(rncs.id, event.rncId)).limit(1);
      if (!record || parsedJson<string[]>(record.manualFields, []).includes("status")) continue;
      const sources = parsedJson<Record<string, string>>(record.fieldSources, {});
      const confidence = parsedJson<Record<string, { score: number; reason: string }>>(record.fieldConfidence, {});
      sources.status = "Identificado no corpo do e-mail oficial de análise";
      confidence.status = result.confidence;
      await db.update(rncs).set({
        status: result.status,
        fieldSources: JSON.stringify(sources),
        fieldConfidence: JSON.stringify(confidence),
        updatedAt: new Date().toISOString(),
      }).where(eq(rncs.id, record.id));
      updated++;
    }
    return Response.json({ updated });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Falha ao reconciliar os retornos.",
    }, { status: 500 });
  }
}
