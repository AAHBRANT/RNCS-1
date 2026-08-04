"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { Sidebar } from "../components/sidebar";
import { Topbar } from "../components/topbar";
import { deadlineResult, fmt } from "../../lib/rnc-deadline";
import { useSidebarCollapse } from "../../lib/use-sidebar-collapse";

type OverviewRnc = {
  id: number; workId: number; workName: string; number: string; year: number;
  description: string; type: string; dueAt: string | null; sentAt: string | null;
  status: string; responseOwner: string; updatedAt: string; hasDraft: boolean;
};
type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };

const ALL = "all";

export default function ResponderPage() {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [rncs, setRncs] = useState<OverviewRnc[]>([]);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [outlook, setOutlook] = useState({ configured: false, connected: false });
  const [allWorks, setAllWorks] = useState<Array<{ id: number; name: string; accessible: boolean }>>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"andamento" | "pendentes">("andamento");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [workId, setWorkId] = useState(ALL);
  const [responsavel, setResponsavel] = useState(ALL);
  const [prazo, setPrazo] = useState(ALL);

  async function loadRncs() {
    setBusy(true);
    const response = await fetch("/api/rncs/response-overview");
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "Não foi possível carregar os dados.");
    else {
      setRncs(data.rncs);
      setAccessUser(data.user || null);
    }
    setBusy(false);
  }

  async function selectWork(id: number) {
    const response = await fetch(`/api/works/${id}/select`, { method: "POST" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setNotice(data.error || "Não foi possível trocar de obra.");
      return;
    }
    setActiveWorkId(id);
    await loadRncs();
  }

  useEffect(() => {
    let active = true;
    fetch("/api/rncs/response-overview")
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) { setNotice(data.error || "Não foi possível carregar os dados."); return; }
        setRncs(data.rncs);
        setAccessUser(data.user || null);
      })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    fetch("/api/outlook/status")
      .then((response) => response.json())
      .then((data) => { if (!data.error) setOutlook(data); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/works")
      .then((response) => response.json())
      .then((data) => {
        if (data.works) setAllWorks(data.works);
        if ("activeWorkId" in data) setActiveWorkId(data.activeWorkId ?? null);
      })
      .catch(() => undefined);
  }, []);

  const works = useMemo(
    () => [...new Map(rncs.map((r) => [r.workId, r.workName])).entries()].map(([id, name]) => ({ id, name })),
    [rncs],
  );
  const statusOptions = useMemo(() => [...new Set(rncs.map((r) => r.status))].sort(), [rncs]);
  const typeOptions = useMemo(() => [...new Set(rncs.map((r) => r.type))].sort(), [rncs]);
  const responsavelOptions = useMemo(
    () => [...new Set(rncs.filter((r) => r.responseOwner).map((r) => r.responseOwner))].sort(),
    [rncs],
  );

  const byTab = useMemo(
    () => rncs.filter((r) => (tab === "andamento" ? r.hasDraft && !r.sentAt : !r.hasDraft)),
    [rncs, tab],
  );

  const filtered = useMemo(() => byTab.filter((r) => {
    const term = search.toLocaleLowerCase("pt-BR");
    const delta = deadlineResult(r).delta;
    return (status === ALL || r.status === status)
      && (type === ALL || r.type === type)
      && (workId === ALL || String(r.workId) === workId)
      && (responsavel === ALL || r.responseOwner === responsavel)
      && (prazo === ALL || (prazo === "onTime" && delta !== null && delta <= 0) || (prazo === "late" && (delta ?? 0) > 0))
      && (!term || `${r.number} ${r.description} ${r.responseOwner}`.toLocaleLowerCase("pt-BR").includes(term));
  }), [byTab, search, status, type, workId, responsavel, prazo]);

  return (
    <div className="app-shell">
      <Topbar activeUser={accessUser} collapsed={collapsed} onToggleCollapse={toggleCollapsed} works={allWorks} activeWorkId={activeWorkId} onSelectWork={selectWork} />
      <Sidebar
        canCreateRnc={accessUser?.role === "admin"}
        outlook={outlook}
        syncing={false}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
        onSync={() => { window.location.href = "/"; }}
        onNewRnc={() => { window.location.href = "/"; }}
        onExportExcel={() => { window.location.href = "/"; }}
        onExportPdf={() => { window.location.href = "/"; }}
      />
      <main className="app-main">
        <section className="page-heading">
          <div><p className="eyebrow">Central de respostas</p><h1>Responder</h1><p>Acompanhe rascunhos em andamento e RNCs ainda sem resposta.</p></div>
          <div className="responder-tabs">
            <button type="button" className={tab === "andamento" ? "active" : ""} onClick={() => setTab("andamento")}>Respostas em andamento</button>
            <button type="button" className={tab === "pendentes" ? "active" : ""} onClick={() => setTab("pendentes")}>Pendentes de resposta</button>
          </div>
        </section>

        <section className="workspace">
          <div className="filters">
            <label className="search"><span><Search size={16} /></span><input aria-label="Pesquisar RNC" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar número, descrição ou responsável…" /></label>
            {works.length > 1 && (
              <select aria-label="Filtrar por obra" value={workId} onChange={(e) => setWorkId(e.target.value)}>
                <option value={ALL}>Todas as obras</option>
                {works.map((w) => <option key={w.id} value={String(w.id)}>{w.name}</option>)}
              </select>
            )}
            <select aria-label="Filtrar por responsável" value={responsavel} onChange={(e) => setResponsavel(e.target.value)}>
              <option value={ALL}>Todos os responsáveis</option>
              {responsavelOptions.map((r) => <option key={r}>{r}</option>)}
            </select>
            <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value={ALL}>Todos os status</option>
              {statusOptions.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select aria-label="Filtrar por categoria" value={type} onChange={(e) => setType(e.target.value)}>
              <option value={ALL}>Todas as categorias</option>
              {typeOptions.map((t) => <option key={t}>{t}</option>)}
            </select>
            <select aria-label="Filtrar por prazo" value={prazo} onChange={(e) => setPrazo(e.target.value)}>
              <option value={ALL}>Todos os prazos</option>
              <option value="onTime">Dentro do prazo</option>
              <option value="late">Fora do prazo</option>
            </select>
          </div>
          <div className="table-meta"><strong>Exibindo {filtered.length} de {byTab.length} registros</strong></div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Nº RNC</th><th>Obra</th><th>Descrição</th><th>Prazo</th><th>Última alteração</th><th>Responsável</th><th /></tr>
              </thead>
              <tbody>
                {busy && <tr><td colSpan={7} className="empty"><strong>Carregando registros…</strong></td></tr>}
                {!busy && !filtered.length && (
                  <tr><td colSpan={7} className="empty"><strong>Nenhuma RNC encontrada</strong><span>Ajuste os filtros ou aguarde novas RNCs.</span></td></tr>
                )}
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td><strong className="rnc-number">RNC {r.number}</strong><small>{r.year}</small></td>
                    <td>{r.workName}</td>
                    <td className="description">{r.description}</td>
                    <td><strong>{fmt(r.dueAt)}</strong><small>{deadlineResult(r).label}</small></td>
                    <td>{fmt(r.updatedAt)}</td>
                    <td>{r.responseOwner || "Não identificado"}</td>
                    <td className="row-actions">
                      <button className="respond-button" onClick={() => { window.location.href = `/responder/editor?rnc=${r.id}`; }}>
                        {tab === "andamento" ? "Continuar resposta" : "Responder"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span><X size={14} /></span></button>}
      </main>
    </div>
  );
}
