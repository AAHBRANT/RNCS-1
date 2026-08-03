import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ensureDatabase, getDb } from "../db";
import { canAccessWork, sessionFromCookieStore } from "../lib/access-control";
import { works } from "../db/schema";
import { eq } from "drizzle-orm";
import { RncApp } from "./rnc-app";

export default async function Home() {
  const cookieStore = await cookies();
  const session = sessionFromCookieStore(cookieStore);

  // Se há sessão e obra ativa, validar que obra ainda existe e tem acesso
  if (session && session.activeWorkId) {
    await ensureDatabase();
    const db = getDb();
    const work = await db.select().from(works).where(eq(works.id, session.activeWorkId)).then((rows) => rows[0]);
    if (!work || !work.active || !canAccessWork(session, session.activeWorkId)) {
      redirect("/selecionar-obra");
    }
  }

  return <RncApp />;
}
