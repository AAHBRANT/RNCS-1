"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, FilterX, Layers, RefreshCw, Sparkles } from "lucide-react";
import { Sidebar } from "../components/sidebar";
import { Topbar } from "../components/topbar";
import { useSidebarCollapse } from "../../lib/use-sidebar-collapse";

type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };
type WorkOption = { id: number; name: string; accessible: boolean };
type Row = {
  id: number; number: string; year: number; description: string; type: string; workName: string; status: string;
  groupId: number | null;
  reason: { text: string; source: string; document: { eventId: number; attachmentId: string; name: string } | null }; comment: string; commentBy: string; commentAt: string | null;
};
type Saved = Pick<Row, "comment" | "commentBy" | "commentAt">;
type Group = { id: number; name: string };
const NO_GROUP = "none";
type Filters = { rnc: string; description: string; group: string; reason: string; comment: string };
const EMPTY_FILTERS: Filters = { rnc: "", description: "", group: "", reason: "", comment: "" };

const norm = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const formatDateTime = (value: string | null) => (value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "");

function ReasonCell({ reason }: { reason: Row["reason"] }) {
  const [open, setOpen] = useState(false);
  const long = reason.text.length > 320;
  return (
    <div className="rj-reason">
      <p className={long && !open ? "clamped" : undefined}>{reason.text}</p>
      {long && <button type="button" className="rj-more" onClick={() => setOpen(!open)}>{open ? "Mostrar menos" : "Ler tudo"}</button>}
      <small>Fonte: {reason.source}</small>
    </div>
  );
}

function CommentCell({ row, onSaved }: { row: Row; onSaved: (id: number, saved: Saved) => void }) {
  const [text, setText] = useState(row.comment);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const dirty = text !== row.comment;

  async function save() {
    setState("saving");
    try {
      const response = await fetch(`/api/rncs/${row.id}/comment`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ comment: text }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      onSaved(row.id, data);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="rj-comment">
      <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} placeholder="Escreva seus comentários sobre esta RNC…" aria-label={`Comentários da RNC ${row.number}/${row.year}`} />
      <small className={state === "error" ? "rj-error" : undefined}>
        {state === "error" ? "Não foi possível salvar. Tente novamente." : dirty ? "Alterações não salvas" : row.commentAt ? `Salvo por ${row.commentBy} em ${formatDateTime(row.commentAt)}` : ""}
      </small>
      <button type="button" className="button secondary" disabled={!dirty || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Salvando…" : "Salvar"}</button>
    </div>
  );
}

export default function ReprovadasPage() {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [rows, setRows] = useState<Row[]>([]);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [outlook, setOutlook] = useState({ configured: false, connected: false });
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, base] = await Promise.all([fetch("/api/rncs/reprovadas", { cache: "no-store" }), fetch("/api/rncs", { cache: "no-store" })]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as RNCs reprovadas.");
      setRows(data.rncs as Row[]);
      setGroups((data.groups || []) as Group[]);
      setAccessUser(data.user || null);
      const baseData = await base.json().catch(() => ({}));
      if (baseData.works) setWorks(baseData.works);
      if ("activeWorkId" in baseData) setActiveWorkId(baseData.activeWorkId ?? null);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível carregar as RNCs reprovadas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void load(); });
    fetch("/api/outlook/status").then((response) => response.json()).then((data) => { if (!data.error) setOutlook(data); }).catch(() => undefined);
  }, [load]);

  async function selectWork(id: number) {
    const response = await fetch(`/api/works/${id}/select`, { method: "POST" });
    if (!response.ok) { setError("Não foi possível trocar de obra."); return; }
    setActiveWorkId(id);
    await load();
  }

  async function callGroups(url: string, init: RequestInit) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
      return data;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível concluir a operação.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function applyGrouping() {
    if (!selected.size || !target) return;
    const rncIds = [...selected];
    let result;
    if (target === "new") {
      const name = window.prompt("Nome do novo grupo:");
      if (!name?.trim()) return;
      result = await callGroups("/api/rnc-groups", { method: "POST", body: JSON.stringify({ name, rncIds }) });
    } else {
      result = await callGroups("/api/rnc-groups/assign", { method: "PUT", body: JSON.stringify({ rncIds, groupId: target === NO_GROUP ? null : Number(target) }) });
    }
    if (!result) return;
    setSelected(new Set());
    setTarget("");
    setNotice(target === NO_GROUP ? `${rncIds.length} RNC(s) tirada(s) do grupo.` : `${rncIds.length} RNC(s) agrupada(s).`);
    await load();
  }

  async function suggest() {
    if (!window.confirm("Agrupar por assunto as RNCs que ainda estão sem grupo, usando a descrição de cada uma? Você poderá renomear e mover tudo depois.")) return;
    const result = await callGroups("/api/rnc-groups/suggest", { method: "POST", body: "{}" });
    if (!result) return;
    setNotice(`${result.assigned} RNC(s) agrupada(s) em ${result.created} grupo(s) novo(s). ${result.left} ficaram sem grupo para você decidir.`);
    await load();
  }

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const needle = {
      rnc: norm(filters.rnc.trim()), description: norm(filters.description.trim()),
      reason: norm(filters.reason.trim()), comment: norm(filters.comment.trim()),
    };
    const matchGroup = (row: Row) => !filters.group || (filters.group === NO_GROUP ? row.groupId === null : String(row.groupId) === filters.group);
    return rows.filter((row) =>
      (!needle.rnc || norm(`${row.number}/${row.year} ${row.workName}`).includes(needle.rnc))
      && (!needle.description || norm(row.description).includes(needle.description))
      && matchGroup(row)
      && (!needle.reason || norm(row.reason.text).includes(needle.reason))
      && (!needle.comment || norm(row.comment).includes(needle.comment)));
  }, [rows, filters]);
  const visibleSelected = filtered.filter((row) => selected.has(row.id)).length;
  const filtering = Object.values(filters).some((value) => value.trim());

  function saved(id: number, patch: Saved) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <div className="app-shell">
      <Topbar activeUser={accessUser} collapsed={collapsed} onToggleCollapse={toggleCollapsed} works={works} activeWorkId={activeWorkId} onSelectWork={selectWork} />
      <Sidebar canCreateRnc={accessUser?.role === "admin"} outlook={outlook} syncing={false} collapsed={collapsed} onToggleCollapse={toggleCollapsed}
        onSync={() => { window.location.href = "/"; }} onNewRnc={() => { window.location.href = "/"; }}
        onExportExcel={() => { window.location.href = "/"; }} onExportPdf={() => { window.location.href = "/"; }} />
      <main className="app-main">
        <section className="page-heading rp-heading">
          <div>
            <p className="eyebrow">Acompanhamento</p>
            <h1>RNCs Reprovadas</h1>
            <p>{loading ? "Carregando…" : `${rows.length} ${rows.length === 1 ? "RNC reprovada" : "RNCs reprovadas"}. O motivo vem da análise da Supervisão (FG 14).`}</p>
          </div>
          <div className="rp-actions">
            <a className="button secondary" href="/reprovadas/grupos"><Layers size={14} /> Relatório dos grupos</a>
            {filtering && <button type="button" className="button secondary" onClick={() => setFilters(EMPTY_FILTERS)}><FilterX size={14} /> Limpar filtros</button>}
            <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Atualizando…" : "Atualizar"}</button>
          </div>
        </section>
        <section className="rp-page">
          {error && <div className="rp-error" role="alert">{error}</div>}
          {notice && <div className="rj-notice" role="status">{notice}</div>}
          <div className="rj-toolbar">
            <button type="button" className="button secondary" onClick={() => void suggest()} disabled={busy || loading}><Sparkles size={14} /> Sugerir grupos por assunto</button>
            <span className="rj-toolbar-sep" />
            <span className="rj-toolbar-label">{selected.size ? `${selected.size} selecionada(s)` : "Marque RNCs para agrupar"}</span>
            <select value={target} onChange={(event) => setTarget(event.target.value)} disabled={!selected.size || busy} aria-label="Grupo de destino">
              <option value="">Escolher grupo…</option>
              <option value="new">+ Novo grupo…</option>
              {groups.map((group) => <option key={group.id} value={String(group.id)}>{group.name}</option>)}
              <option value={NO_GROUP}>Tirar do grupo</option>
            </select>
            <button type="button" className="button" onClick={() => void applyGrouping()} disabled={!selected.size || !target || busy}>Aplicar</button>
            {visibleSelected < filtered.length && filtered.length > 0 && <button type="button" className="rj-link" onClick={() => setSelected(new Set(filtered.map((row) => row.id)))}>Selecionar as {filtered.length} filtradas</button>}
            {selected.size > 0 && <button type="button" className="rj-link" onClick={() => setSelected(new Set())}>Limpar seleção</button>}
          </div>
          <div className="rp-panel">
            <div className="rp-table-wrap">
              <table className="rp-table rj-table">
                <colgroup><col className="rj-c-rnc" /><col className="rj-c-desc" /><col className="rj-c-group" /><col className="rj-c-reason" /><col className="rj-c-comment" /><col className="rj-c-view" /></colgroup>
                <thead>
                  <tr><th>RNC</th><th>Descrição</th><th>Grupo</th><th>Motivo da reprovação</th><th>Comentários</th><th title="Abrir o FG 14">FG 14</th></tr>
                  <tr className="rj-filter-row">
                    {(["rnc", "description", "group", "reason", "comment"] as const).map((key) => key === "group" ? (
                      <th key={key}>
                        <select value={filters.group} onChange={(event) => setFilters({ ...filters, group: event.target.value })} aria-label="Filtrar por grupo">
                          <option value="">Todos</option>
                          <option value={NO_GROUP}>Sem grupo</option>
                          {groups.map((group) => <option key={group.id} value={String(group.id)}>{group.name}</option>)}
                        </select>
                      </th>
                    ) : (
                      <th key={key}>
                        <input value={filters[key]} onChange={(event) => setFilters({ ...filters, [key]: event.target.value })} placeholder="Filtrar…" aria-label={`Filtrar por ${key === "rnc" ? "RNC" : key === "description" ? "descrição" : key === "reason" ? "motivo" : "comentários"}`} />
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <label className="rj-check"><input type="checkbox" checked={selected.has(row.id)} onChange={() => toggle(row.id)} aria-label={`Selecionar a RNC ${row.number}/${row.year}`} /><strong>{row.number}/{row.year}</strong></label>
                      </td>
                      <td>{row.description}</td>
                      <td>{row.groupId ? <span className="rj-chip">{groups.find((group) => group.id === row.groupId)?.name ?? "—"}</span> : <span className="rj-nogroup">Sem grupo</span>}</td>
                      <td><ReasonCell reason={row.reason} /></td>
                      <td><CommentCell row={row} onSaved={saved} /></td>
                      <td className="rj-view">
                        {row.reason.document ? (
                          <a className="rj-eye" href={`/api/rncs/${row.id}/dossier-attachment?eventId=${row.reason.document.eventId}&attachmentId=${encodeURIComponent(row.reason.document.attachmentId)}`} target="_blank" rel="noopener noreferrer" title={`Abrir ${row.reason.document.name}`} aria-label={`Abrir o FG 14 da RNC ${row.number}/${row.year}`}><Eye size={16} /></a>
                        ) : <span title="FG 14 não localizado">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!filtered.length && <p className="rp-empty">{loading ? "Carregando dados…" : filtering ? "Nenhuma RNC corresponde aos filtros." : "Nenhuma RNC reprovada encontrada."}</p>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
