import { plannerContext, plannerErrorResponse } from "../../../../lib/planner-api";
import { getBands, setBands } from "../../../../lib/planner-service";

export async function GET(request: Request) {
  try {
    const context = await plannerContext(request);
    if ("error" in context) return context.error;
    return Response.json({ bands: await getBands(context.db) });
  } catch (error) {
    return plannerErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    const context = await plannerContext(request, { requireAdmin: true });
    if ("error" in context) return context.error;
    const body = await request.json() as Record<string, unknown>;
    return Response.json({ bands: await setBands(context.db, body.bands) });
  } catch (error) {
    return plannerErrorResponse(error);
  }
}
