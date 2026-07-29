import { and, desc, eq } from "drizzle-orm";
import { ensureDatabase, getDb } from "../../../db";
import { auditLog, rncs, works } from "../../../db/schema";

const initialWorks = [
  "Parque do Roger - Fase II",
  "Ponte Rio Cuiá",
  "Compl. Beira Rio",
];

const renamedWorks = [
  ["Parque Socioambiental do Roger", "Parque do Roger - Fase II"],
  ["Parque Linear do Cuiá", "Ponte Rio Cuiá"],
  ["Parque Beira Rio", "Compl. Beira Rio"],
] as const;

const editableFields = [
  "workId", "number", "year", "description", "type", "receivedAt", "dueAt",
  "sentAt", "returnedAt", "status", "notes", "responseOwner", "analysisOwner",
] as const;

function addBusinessDays(dateValue: string, days = 5) {
  const date = new Date(`${dateValue}T12:00:00`);
  let added = 0;
  while (added < days) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() !== 0 && date.getDay() !== 6) added += 1;
  }
  return date.toISOString().slice(0, 10);
}

async function ensureWorks() {
  await ensureDatabase();
  const db = getDb();
  for (const [oldName, newName] of renamedWorks) {
    await db.update(works).set({ name: newName }).where(eq(works.name, oldName));
  }
  for (const name of initialWorks) {
    await db.insert(works).values({ name }).onConflictDoNothing();
  }
}

export async function GET() {
  try {
    await ensureWorks();
    const db = getDb();
    const [workRows, rncRows] = await Promise.all([
      db.select().from(works).where(eq(works.active, true)).orderBy(works.name),
      db.select({
        id: rncs.id,
        workId: rncs.workId,
        workName: works.name,
        number: rncs.number,
        year: rncs.year,
        description: rncs.description,
        type: rncs.type,
        receivedAt: rncs.receivedAt,
        dueAt: rncs.dueAt,
        sentAt: rncs.sentAt,
        returnedAt: rncs.returnedAt,
        status: rncs.status,
        notes: rncs.notes,
        responseOwner: rncs.responseOwner,
        analysisOwner: rncs.analysisOwner,
        fieldSources: rncs.fieldSources,
        manualFields: rncs.manualFields,
        sourceSummary: rncs.sourceSummary,
        updatedAt: rncs.updatedAt,
      }).from(rncs).innerJoin(works, eq(rncs.workId, works.id)).orderBy(desc(rncs.year), desc(rncs.id)),
    ]);
    return Response.json({ works: workRows, rncs: rncRows });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao carregar dados." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const receivedAt = String(body.receivedAt ?? "");
    const number = String(body.number ?? "").trim().padStart(3, "0");
    if (!body.workId || !number || !body.year || !receivedAt) {
      return Response.json({ error: "Obra, número, ano e recebimento são obrigatórios." }, { status: 400 });
    }
    const db = getDb();
    const [created] = await db.insert(rncs).values({
      workId: Number(body.workId),
      number,
      year: Number(body.year),
      description: String(body.description || "Descrição não identificada"),
      type: String(body.type || "A classificar"),
      receivedAt,
      dueAt: addBusinessDays(receivedAt),
      status: String(body.status || "Recebida"),
      notes: String(body.notes || ""),
      responseOwner: String(body.responseOwner || ""),
      analysisOwner: String(body.analysisOwner || ""),
      sentAt: body.sentAt ? String(body.sentAt) : null,
      returnedAt: body.returnedAt ? String(body.returnedAt) : null,
      fieldSources: JSON.stringify({
        workId: "Preenchido manualmente", number: "Preenchido manualmente", year: "Preenchido manualmente",
        description: "Preenchido manualmente", type: "Preenchido manualmente",
        receivedAt: "Preenchido manualmente", sentAt: body.sentAt ? "Preenchido manualmente" : undefined,
        returnedAt: body.returnedAt ? "Preenchido manualmente" : undefined,
        status: "Preenchido manualmente", notes: "Preenchido manualmente",
        responseOwner: "Preenchido manualmente", analysisOwner: "Preenchido manualmente",
      }),
      manualFields: JSON.stringify(["workId", "description", "type", "notes", "responseOwner", "analysisOwner"]),
    }).returning();
    await db.insert(auditLog).values({ rncId: created.id, field: "registro", newValue: "RNC criada manualmente" });
    return Response.json({ rnc: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao cadastrar RNC.";
    const duplicate = message.includes("UNIQUE");
    return Response.json({ error: duplicate ? "Já existe uma RNC com esta obra, número e ano." : message }, { status: duplicate ? 409 : 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!id) return Response.json({ error: "RNC inválida." }, { status: 400 });
    const db = getDb();
    const [current] = await db.select().from(rncs).where(eq(rncs.id, id)).limit(1);
    if (!current) return Response.json({ error: "RNC não encontrada." }, { status: 404 });

    const changes: Record<string, string | number | null> = {};
    const auditRows: Array<typeof auditLog.$inferInsert> = [];
    const manualFields = new Set<string>(JSON.parse(current.manualFields || "[]"));
    const fieldSources = JSON.parse(current.fieldSources || "{}") as Record<string, string>;
    for (const field of editableFields) {
      if (!(field in body)) continue;
      let next: string | number | null = body[field] === "" ? null : body[field] as string | number | null;
      if (field === "year" || field === "workId") next = Number(next);
      if (field === "number") next = String(next).padStart(3, "0");
      const previous = current[field];
      if (String(previous ?? "") !== String(next ?? "")) {
        changes[field] = next;
        manualFields.add(field);
        fieldSources[field] = "Preenchido manualmente";
        auditRows.push({ rncId: id, field, oldValue: String(previous ?? ""), newValue: String(next ?? "") });
      }
    }
    if ("receivedAt" in changes && changes.receivedAt) changes.dueAt = addBusinessDays(String(changes.receivedAt));
    if (!Object.keys(changes).length) return Response.json({ rnc: current });
    changes.manualFields = JSON.stringify([...manualFields]);
    changes.fieldSources = JSON.stringify(fieldSources);
    changes.updatedAt = new Date().toISOString();
    const [updated] = await db.update(rncs).set(changes).where(and(eq(rncs.id, id))).returning();
    if (auditRows.length) await db.insert(auditLog).values(auditRows);
    return Response.json({ rnc: updated });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao atualizar RNC." }, { status: 500 });
  }
}
