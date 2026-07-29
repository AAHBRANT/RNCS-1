import { synchronizeOutlook } from "../../../../lib/outlook-sync";

export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { cursor?: string };
    return Response.json(await synchronizeOutlook({ force: true, cursor: body.cursor }));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao atualizar e-mails." }, { status: 500 });
  }
}
