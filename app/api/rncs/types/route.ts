import { ensureDatabase } from "../../../../db";
import { sessionFromRequest, unauthorized } from "../../../../lib/access-control";
import { RNC_TYPES } from "../../../../lib/pdf/classify-type";

export async function GET(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    await ensureDatabase();
    return new Response(JSON.stringify({ types: [...RNC_TYPES, "A classificar"] }), {
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
