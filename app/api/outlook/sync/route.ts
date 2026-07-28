import { synchronizeOutlook } from "../../../../lib/outlook-sync";

export async function POST() {
  try {
    return Response.json(await synchronizeOutlook());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao atualizar e-mails." }, { status: 500 });
  }
}
