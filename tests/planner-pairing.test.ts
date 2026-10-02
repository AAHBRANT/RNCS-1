import assert from "node:assert/strict";
import test from "node:test";
import { isoInBrazil, parseTimestamp } from "../lib/planner-calc";
import { pairSendings } from "../lib/planner-pairing";

const pamV = (id: number, createdAt: string) => ({ id, responseType: "PAM", createdAt });
const tratV = (id: number, createdAt: string) => ({ id, responseType: "TRATATIVA", createdAt });
const sendAt = (id: number, occurredAt: string) => ({ id, occurredAt });

test("o envio pertence ao PAM salvo antes dele e usa a data do e-mail, não a da gravação", () => {
  const result = pairSendings({
    versions: [pamV(10, "2026-11-28T10:00:00Z")],
    events: [sendAt(1, "2026-12-01T14:30:00Z")],
    pams: [],
  });
  assert.deepEqual(result, [{ eventId: 1, versionId: 10, sentAt: "2026-12-01" }]);
});

test("e-mail de envio de tratativa não é tratado como envio de PAM", () => {
  const result = pairSendings({
    versions: [pamV(10, "2026-11-28T10:00:00Z"), tratV(11, "2026-11-30T10:00:00Z")],
    events: [sendAt(1, "2026-12-01T14:30:00Z")],
    pams: [],
  });
  assert.deepEqual(result, []);
});

test("envio sem nenhuma resposta salva antes dele é ignorado", () => {
  assert.deepEqual(pairSendings({ versions: [pamV(10, "2026-12-05T10:00:00Z")], events: [sendAt(1, "2026-12-01T14:30:00Z")], pams: [] }), []);
  assert.deepEqual(pairSendings({ versions: [], events: [sendAt(1, "2026-12-01T14:30:00Z")], pams: [] }), []);
});

test("vários e-mails depois do mesmo PAM: só o primeiro define a data de envio", () => {
  const result = pairSendings({
    versions: [pamV(10, "2026-11-28T10:00:00Z")],
    events: [sendAt(2, "2026-12-03T14:30:00Z"), sendAt(1, "2026-12-01T14:30:00Z")],
    pams: [],
  });
  assert.deepEqual(result, [{ eventId: 1, versionId: 10, sentAt: "2026-12-01" }]);
});

test("PAM já enviado não é reatribuído; o novo PAM recebe o novo envio", () => {
  const result = pairSendings({
    versions: [pamV(10, "2026-11-01T10:00:00Z"), pamV(11, "2026-12-10T10:00:00Z")],
    events: [sendAt(1, "2026-11-02T12:00:00Z"), sendAt(2, "2026-12-11T12:00:00Z")],
    pams: [{ responseVersionId: 10, sentAt: "2026-11-02", sentEventId: 1 }],
  });
  assert.deepEqual(result, [{ eventId: 2, versionId: 11, sentAt: "2026-12-11" }]);
});

test("PAM com data de envio informada manualmente não é sobrescrito por e-mail posterior", () => {
  const result = pairSendings({
    versions: [pamV(10, "2026-11-01T10:00:00Z")],
    events: [sendAt(7, "2026-11-20T12:00:00Z")],
    pams: [{ responseVersionId: 10, sentAt: "2026-11-05", sentEventId: null }],
  });
  assert.deepEqual(result, []);
});

test("fuso de Brasília: e-mail às 22h30 locais continua no mesmo dia", () => {
  assert.equal(isoInBrazil("2026-12-02T01:30:00Z"), "2026-12-01");
  assert.equal(isoInBrazil("2026-12-01T15:00:00Z"), "2026-12-01");
  const result = pairSendings({
    versions: [pamV(10, "2026-11-28T10:00:00Z")],
    events: [sendAt(1, "2026-12-02T01:30:00Z")],
    pams: [],
  });
  assert.equal(result[0].sentAt, "2026-12-01");
});

test("timestamps do banco com fuso abreviado são interpretados", () => {
  assert.equal(parseTimestamp("2026-08-05 18:07:34+00").toISOString(), "2026-08-05T18:07:34.000Z");
  assert.equal(parseTimestamp("2026-08-05T18:07:34.000Z").toISOString(), "2026-08-05T18:07:34.000Z");
  assert.equal(isoInBrazil("2026-08-05 02:30:00+00"), "2026-08-04");
});
