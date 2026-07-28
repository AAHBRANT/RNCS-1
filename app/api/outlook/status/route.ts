import { ensureDatabase, getDb } from "../../../../db";
import { outlookConnections } from "../../../../db/schema";

export async function GET() {
  try {
    await ensureDatabase();
    const [connection] = await getDb().select({
      accountEmail: outlookConnections.accountEmail,
      connectedAt: outlookConnections.connectedAt,
      lastSyncAt: outlookConnections.lastSyncAt,
      lastSyncStatus: outlookConnections.lastSyncStatus,
      lastSyncMessage: outlookConnections.lastSyncMessage,
    }).from(outlookConnections).limit(1);
    return Response.json({ configured: Boolean(process.env.MICROSOFT_CLIENT_ID), connected: Boolean(connection), connection });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao verificar Outlook." }, { status: 500 });
  }
}
