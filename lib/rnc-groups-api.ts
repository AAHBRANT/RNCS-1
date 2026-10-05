import { desc } from "drizzle-orm";
import { ensureDatabase, getDb } from "../db";
import { rncs } from "../db/schema";
import { sessionFromRequest, unauthorized, type AccessSession } from "./access-control";
import { canSeeRnc } from "./planner-api";

export type GroupRnc = { id: number; number: string; year: number; description: string };

export async function groupsContext(request: Request) {
  const session = sessionFromRequest(request);
  if (!session) return { error: unauthorized() };
  await ensureDatabase();
  return { session, db: getDb() };
}

// RNCs reprovadas que a usuária pode ver (mesma regra da página "Reprovadas").
export async function scopedReprovadas(db: ReturnType<typeof getDb>, session: AccessSession): Promise<GroupRnc[]> {
  const rows = await db.select({
    id: rncs.id, number: rncs.number, year: rncs.year, description: rncs.description, type: rncs.type, status: rncs.status, workId: rncs.workId,
  }).from(rncs).orderBy(desc(rncs.year), desc(rncs.number));
  return rows
    .filter((rnc) => rnc.status.startsWith("Reprovada") && canSeeRnc(session, rnc))
    .map(({ id, number, year, description }) => ({ id, number, year, description }));
}

export function cleanGroupName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}
