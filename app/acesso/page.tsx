import Image from "next/image";

export default async function AccessPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return <main className="access-page">
    <section className="access-card">
      <Image className="access-logo" src="/favicon-rnc.png" alt="RNC" width={76} height={76} priority />
      <p className="eyebrow">Acesso corporativo</p>
      <h1>Controle de RNC</h1>
      <p>Use sua conta Microsoft da Aahbrant. O sistema não cria nem armazena uma senha própria.</p>
      {error && <div className="access-error">{error}</div>}
      <a className="button primary link-button access-button" href="/api/auth/login">Continuar com Microsoft</a>
      <small>O acesso e as disciplinas disponíveis são definidos pela administração do sistema.</small>
    </section>
  </main>;
}
