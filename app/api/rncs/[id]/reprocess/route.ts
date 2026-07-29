import { synchronizeOutlook } from "../../../../../lib/outlook-sync";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const rncId = Number(id);
    if (!rncId) return Response.json({ error: "RNC inválida." }, { status: 400 });
    return Response.json(await synchronizeOutlook({ force: true, targetRncId: rncId }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao reprocessar a RNC." }, { status: 500 });
  }
}
