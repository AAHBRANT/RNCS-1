import { synchronizeOutlook } from "../../../../lib/outlook-sync";

export const maxDuration = 300;

export async function POST() {
  try {
    return Response.json(await synchronizeOutlook({ force: true }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao atualizar e-mails." }, { status: 500 });
  }
}
