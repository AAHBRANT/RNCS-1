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
    const [events, records] = await Promise.all([
      db.select().from(emailEvents).orderBy(asc(emailEvents.occurredAt)),
      db.select().from(rncs),
    ]);
    let updated = 0;
    for (const event of events.filter((item) => item.eventType === "retorno_supervisao")) {
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
    let sentDatesReconciled = 0;
    for (const record of records) {
      const manualFields = parsedJson<string[]>(record.manualFields, []);
      const recordEvents = events.filter((event) => event.rncId === record.id);
      const sentDates = recordEvents.filter((event) => event.eventType === "envio_resposta")
        .map((event) => event.occurredAt.slice(0, 10)).sort();
      const hasReturn = recordEvents.some((event) => event.eventType === "retorno_supervisao");
      const officialSentAt = sentDates[0] || null;
      const changes: Partial<typeof rncs.$inferInsert> = {};
      const sources = parsedJson<Record<string, string>>(record.fieldSources, {});
      const confidence = parsedJson<Record<string, { score: number; reason: string }>>(record.fieldConfidence, {});
      if (!manualFields.includes("sentAt") && record.sentAt !== officialSentAt) {
        changes.sentAt = officialSentAt;
        sources.sentAt = officialSentAt ? "Identificado nos Itens Enviados" : "Não identificado";
        confidence.sentAt = officialSentAt
          ? { score: 5, reason: "Primeiro envio oficial confirmado no dossiê." }
          : { score: 1, reason: "Nenhum envio oficial específico para esta RNC foi localizado." };
        sentDatesReconciled++;
      }
      if (!hasReturn && !manualFields.includes("status")) {
        const expectedStatus = officialSentAt ? "Respondida" : "Recebida";
        if (record.status !== expectedStatus) {
          changes.status = expectedStatus;
          sources.status = officialSentAt ? "Identificado nos Itens Enviados" : "Identificado no e-mail recebido";
          confidence.status = {
            score: 5,
            reason: officialSentAt
              ? "Existe envio oficial específico e ainda não há retorno da análise."
              : "Ainda não existe envio oficial específico para esta RNC.",
          };
        }
      }
      if (Object.keys(changes).length) {
        changes.fieldSources = JSON.stringify(sources);
        changes.fieldConfidence = JSON.stringify(confidence);
        changes.updatedAt = new Date().toISOString();
        await db.update(rncs).set(changes).where(eq(rncs.id, record.id));
        updated++;
      }
    }
    return Response.json({ updated, sentDatesReconciled });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "Falha ao reconciliar os retornos.",
    }, { status: 500 });
  }
}
