import { ensureDatabase, getDb } from "../../../db";
import { canAccessWork, sessionFromRequest, unauthorized } from "../../../lib/access-control";
import { works } from "../../../db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();

    await ensureDatabase();
    const db = getDb();

    const activeRows = await db.select().from(works).where(eq(works.active, true));
    const workList = activeRows.map((work) => ({
      id: work.id,
      name: work.name,
      accessible: canAccessWork(session, work.id),
    }));

    return Response.json({
      works: workList,
      activeWorkId: session.activeWorkId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
}
