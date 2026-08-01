import { desc } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { rncs } from "../../../../db/schema";
import { sessionFromRequest, unauthorized } from "../../../../lib/access-control";

const defaultTypes = ["Segurança do Trabalho", "Ambiental", "Qualidade", "Projeto", "Execução", "Documental", "Outro", "A classificar"];

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    await ensureDatabase();
    const db = getDb();
    const rows = await db.selectDistinct({ type: rncs.type }).from(rncs).orderBy(desc(rncs.type));
    const types = [...new Set([
      ...defaultTypes,
      ...rows.map((row) => row.type).filter((type) => type && type !== "A classificar"),
    ])].sort((a, b) => {
      if (a === "A classificar") return 1;
      if (b === "A classificar") return -1;
      return a.localeCompare(b, "pt-BR");
    });
    return new Response(JSON.stringify({ types }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
