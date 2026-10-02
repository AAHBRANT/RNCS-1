"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Eye, RefreshCw, Search } from "lucide-react";
import { Sidebar } from "../components/sidebar";
import { Topbar } from "../components/topbar";
import { useSidebarCollapse } from "../../lib/use-sidebar-collapse";

type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };
type WorkOption = { id: number; name: string; accessible: boolean };
type Row = {
  id: number; number: string; year: number; description: string; type: string; workName: string; status: string;
  reason: { text: string; source: string; document: { eventId: number; attachmentId: string; name: string } | null }; comment: string; commentBy: string; commentAt: string | null;
};
type Saved = Pick<Row, "comment" | "commentBy" | "commentAt">;

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
      <div>
        <button type="button" className="button secondary" disabled={!dirty || state === "saving"} onClick={() => void save()}>{state === "saving" ? "Salvando…" : "Salvar"}</button>
        <small className={state === "error" ? "rj-error" : undefined}>
          {state === "error" ? "Não foi possível salvar. Tente novamente." : dirty ? "Alterações não salvas" : row.commentAt ? `Salvo por ${row.commentBy} em ${formatDateTime(row.commentAt)}` : ""}
        </small>
      </div>
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
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, base] = await Promise.all([fetch("/api/rncs/reprovadas", { cache: "no-store" }), fetch("/api/rncs", { cache: "no-store" })]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as RNCs reprovadas.");
      setRows(data.rncs as Row[]);
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => `${row.number}/${row.year} ${row.description} ${row.reason.text} ${row.comment}`.toLowerCase().includes(needle));
  }, [rows, query]);

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
            <label>Buscar
              <span className="rj-search"><Search size={13} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Número, descrição ou motivo" /></span>
            </label>
            <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Atualizando…" : "Atualizar"}</button>
          </div>
        </section>
        <section className="rp-page">
          {error && <div className="rp-error" role="alert">{error}</div>}
          <div className="rp-panel">
            <div className="rp-table-wrap">
              <table className="rp-table rj-table">
                <thead><tr><th>RNC</th><th>Descrição</th><th>Motivo da reprovação</th><th>Comentários</th><th>FG 14</th></tr></thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td><strong>{row.number}/{row.year}</strong><small>{row.workName}</small></td>
                      <td>{row.description}</td>
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
              {!filtered.length && <p className="rp-empty">{loading ? "Carregando dados…" : "Nenhuma RNC reprovada encontrada."}</p>}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
