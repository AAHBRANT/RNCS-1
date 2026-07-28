import { desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../../db";
import { auditLog, emailEvents } from "../../../../../db/schema";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const rncId = Number(id);
  if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });
  await ensureDatabase();
  const db = getDb();
  const [changes, emails] = await Promise.all([
    db.select().from(auditLog).where(eq(auditLog.rncId, rncId)).orderBy(desc(auditLog.changedAt)),
    db.select().from(emailEvents).where(eq(emailEvents.rncId, rncId)).orderBy(desc(emailEvents.occurredAt)),
  ]);
  return Response.json({ changes, emails });
}
