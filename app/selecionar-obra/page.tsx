import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ensureDatabase, getDb } from "../../db";
import { canAccessWork, sessionFromCookieStore } from "../../lib/access-control";
import { works } from "../../db/schema";
import { eq } from "drizzle-orm";
import { BlockedWorkCard } from "./blocked-work-card";
import Image from "next/image";

export default async function SelectWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const cookieStore = await cookies();
  const session = sessionFromCookieStore(cookieStore);

  if (!session) {
    redirect("/acesso");
  }

  await ensureDatabase();
  const db = getDb();

  const activeWorks = await db.select().from(works).where(eq(works.active, true));

  // Se o usuário só tem acesso a uma obra, redirecionar automaticamente
  const accessibleWorks = activeWorks.filter((w) => canAccessWork(session, w.id));
  if (accessibleWorks.length === 1) {
    redirect(`/api/works/${accessibleWorks[0].id}/select`);
  }

  const params = await searchParams;
  const error = params.error;

  return (
    <div className="select-work-page">
      <div className="select-work-container">
        <div className="select-work-header">
          <Image src="/favicon-rnc.png" alt="RNC" width={48} height={48} />
          <h1>Selecione uma obra</h1>
        </div>

        {error && (
          <div className="error-banner">
            <p>{error}</p>
          </div>
        )}

        <div className="works-grid">
          {activeWorks.map((work) => {
            const accessible = canAccessWork(session, work.id);
            if (accessible) {
              return (
                <a
                  key={work.id}
                  href={`/api/works/${work.id}/select`}
                  className="work-card accessible"
                >
                  <h3>{work.name}</h3>
                  <p className="status">Acessível</p>
                </a>
              );
            } else {
              return <BlockedWorkCard key={work.id} name={work.name} />;
            }
          })}
        </div>

        <div className="select-work-footer">
          <a href="/api/auth/logout" className="link-secondary">
            Sair
          </a>
        </div>
      </div>
    </div>
  );
}
