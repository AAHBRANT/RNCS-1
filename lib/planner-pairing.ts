import { isoInBrazil, parseTimestamp } from "./planner-calc";

export type PairingVersion = { id: number; responseType: string; createdAt: string };
export type PairingEvent = { id: number; occurredAt: string };
export type PairingPam = { responseVersionId: number; sentAt: string | null; sentEventId: number | null };
export type Pairing = { eventId: number; versionId: number; sentAt: string };

// Decide qual versão de PAM cada e-mail de envio realmente enviou.
// Regra: o envio pertence à ÚLTIMA resposta salva antes dele, e só se ela for um PAM. Assim, o envio de uma
// tratativa nunca é tratado como envio de PAM, e a data-base é a do e-mail (fuso de Brasília), não a da gravação.
// `versions` deve vir em ordem cronológica de gravação.
export function pairSendings(input: { versions: PairingVersion[]; events: PairingEvent[]; pams: PairingPam[] }): Pairing[] {
  const usedEvents = new Set(input.pams.map((pam) => pam.sentEventId).filter((id): id is number => id !== null));
  const sentVersions = new Set(input.pams.filter((pam) => pam.sentAt).map((pam) => pam.responseVersionId));
  const events = [...input.events].sort((a, b) => parseTimestamp(a.occurredAt).getTime() - parseTimestamp(b.occurredAt).getTime());
  const result: Pairing[] = [];

  for (const event of events) {
    if (usedEvents.has(event.id)) continue;
    const eventTime = parseTimestamp(event.occurredAt).getTime();
    const latest = input.versions.filter((version) => parseTimestamp(version.createdAt).getTime() <= eventTime).at(-1);
    if (!latest || latest.responseType !== "PAM" || sentVersions.has(latest.id)) continue;
    result.push({ eventId: event.id, versionId: latest.id, sentAt: isoInBrazil(event.occurredAt) });
    sentVersions.add(latest.id);
    usedEvents.add(event.id);
  }
  return result;
}
