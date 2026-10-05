import { eq } from "drizzle-orm";
import { rncGroupMembers, rncGroups } from "../../../../db/schema";
import { cleanGroupName, groupsContext } from "../../../../lib/rnc-groups-api";

// Renomeia o grupo e/ou salva o comentário dele.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await groupsContext(request);
    if ("error" in ctx) return ctx.error;
    const { db, session } = ctx;
    const id = Number((await context.params).id);
    const body = await request.json() as { name?: unknown; comment?: unknown };
    const [group] = await db.select().from(rncGroups).where(eq(rncGroups.id, id)).limit(1);
    if (!group) return Response.json({ error: "Grupo não encontrado." }, { status: 404 });

    const changes: Partial<typeof rncGroups.$inferInsert> = { updatedBy: session.name, updatedAt: new Date().toISOString() };
    if (body.name !== undefined) {
      const name = cleanGroupName(body.name);
      if (!name) return Response.json({ error: "O nome do grupo não pode ficar vazio." }, { status: 400 });
      const others = await db.select({ id: rncGroups.id, name: rncGroups.name }).from(rncGroups);
      if (others.some((other) => other.id !== id && other.name.toLowerCase() === name.toLowerCase())) {
        return Response.json({ error: "Já existe um grupo com esse nome." }, { status: 409 });
      }
      changes.name = name;
    }
    if (body.comment !== undefined) changes.comment = String(body.comment).slice(0, 5000);
    const [updated] = await db.update(rncGroups).set(changes).where(eq(rncGroups.id, id)).returning();
    return Response.json({ id: updated.id, name: updated.name, comment: updated.comment, updatedBy: updated.updatedBy, updatedAt: updated.updatedAt });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao salvar o grupo." }, { status: 500 });
  }
}

// Exclui o grupo; as RNCs voltam a ficar "sem grupo" (nada é apagado das RNCs).
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await groupsContext(request);
    if ("error" in ctx) return ctx.error;
    const id = Number((await context.params).id);
    await ctx.db.delete(rncGroupMembers).where(eq(rncGroupMembers.groupId, id));
    await ctx.db.delete(rncGroups).where(eq(rncGroups.id, id));
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Erro ao excluir o grupo." }, { status: 500 });
  }
}
