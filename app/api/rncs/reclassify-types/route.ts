import { eq, notInArray } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../../db";
import { emailEvents, rncs } from "../../../../db/schema";
import { canEditRnc, forbidden, sessionFromRequest, unauthorized } from "../../../../lib/access-control";
import { classifyRncType, RNC_TYPES } from "../../../../lib/pdf/classify-type";

export const maxDuration = 300;

type AttachmentAuditEntry = { extractedText?: string };

function textFromAttachmentMetadata(raw: string | null) {
  if (!raw) return "";
  try {
    const attachments = JSON.parse(raw) as AttachmentAuditEntry[];
    return attachments.map((item) => item.extractedText || "").join("\n");
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  try {
    const session = sessionFromRequest(request);
    if (!session) return unauthorized();
    if (!canEditRnc(session)) return forbidden("Somente a administradora pode reclassificar os tipos das RNCs.");

    await ensureDatabase();
    const db = getDb();

    const invalidRncs = await db.select().from(rncs).where(notInArray(rncs.type, [...RNC_TYPES]));

    let corrected = 0;
    let unchanged = 0;
    const needsManualReview: Array<{ id: number; number: string; year: number; previousType: string }> = [];

    for (const rnc of invalidRncs) {
      const events = await db.select({ attachmentMetadata: emailEvents.attachmentMetadata })
        .from(emailEvents).where(eq(emailEvents.rncId, rnc.id));
      const attachmentsText = events.map((event) => textFromAttachmentMetadata(event.attachmentMetadata)).join("\n");
      const combinedText = `${rnc.description}\n${rnc.notes}\n${attachmentsText}`;
      const { type } = classifyRncType(combinedText);

      if (type) {
        await db.update(rncs).set({ type, updatedAt: new Date().toISOString() }).where(eq(rncs.id, rnc.id));
        corrected += 1;
      } else {
        unchanged += 1;
        needsManualReview.push({ id: rnc.id, number: rnc.number, year: rnc.year, previousType: rnc.type });
      }
    }

    return Response.json({
      analyzed: invalidRncs.length,
      corrected,
      unchanged,
      needsManualReview,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Falha ao reclassificar os tipos." }, { status: 500 });
  }
}
