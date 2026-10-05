"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Plus, Printer, RefreshCw, Trash2 } from "lucide-react";
import { Sidebar } from "../../components/sidebar";
import { Topbar } from "../../components/topbar";
import { useSidebarCollapse } from "../../../lib/use-sidebar-collapse";

type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };
type WorkOption = { id: number; name: string; accessible: boolean };
type GroupRnc = { id: number; number: string; year: number; description: string };
type Group = { id: number; name: string; comment: string; updatedBy: string; updatedAt: string | null; rncs: GroupRnc[] };

const formatDateTime = (value: string | null) => (value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "");
const label = (rnc: GroupRnc) => `${rnc.number}/${rnc.year}`;

async function request(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a operação.");
  return data;
}

function GroupCard({ group, onChanged, onError }: { group: Group; onChanged: () => Promise<void>; onError: (message: string) => void }) {
  const [name, setName] = useState(group.name);
  const [comment, setComment] = useState(group.comment);
  const [busy, setBusy] = useState(false);
  const nameDirty = name.trim() !== group.name;
  const commentDirty = comment !== group.comment;

  async function save(body: { name?: string; comment?: string }) {
    setBusy(true);
    try {
      await request(`/api/rnc-groups/${group.id}`, { method: "PATCH", body: JSON.stringify(body) });
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Excluir o grupo "${group.name}"? As ${group.rncs.length} RNC(s) voltam a ficar sem grupo; nenhuma RNC é apagada.`)) return;
    setBusy(true);
    try {
      await request(`/api/rnc-groups/${group.id}`, { method: "DELETE", body: "{}" });
      await onChanged();
    } catch (failure) {
      onError(failure instanceof Error ? failure.message : "Não foi possível excluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="gr-card">
      <header className="gr-card-head">
        <div className="gr-name">
          <input value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && nameDirty && name.trim()) void save({ name }); }} aria-label={`Nome do grupo ${group.name}`} maxLength={80} />
          {nameDirty && <button type="button" className="button rj-noprint" disabled={busy || !name.trim()} onClick={() => void save({ name })}>Renomear</button>}
        </div>
        <span className="gr-count">{group.rncs.length} {group.rncs.length === 1 ? "RNC" : "RNCs"}</span>
        <button type="button" className="gr-delete rj-noprint" onClick={() => void remove()} disabled={busy} title="Excluir grupo" aria-label={`Excluir o grupo ${group.name}`}><Trash2 size={15} /></button>
      </header>
      {group.rncs.length ? (
        <ul className="gr-rncs">
          {group.rncs.map((rnc) => <li key={rnc.id}><strong>{label(rnc)}</strong><span>{rnc.description}</span></li>)}
        </ul>
      ) : <p className="gr-empty">Nenhuma RNC reprovada neste grupo. Use a página Reprovadas para incluir RNCs.</p>}
      <div className="gr-comment">
        <textarea rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Comentários sobre este grupo…" aria-label={`Comentários do grupo ${group.name}`} />
        <div className="rj-noprint">
          <button type="button" className="button secondary" disabled={!commentDirty || busy} onClick={() => void save({ comment })}>{busy && commentDirty ? "Salvando…" : "Salvar comentário"}</button>
          <small>{commentDirty ? "Alterações não salvas" : group.updatedAt && group.comment ? `Salvo por ${group.updatedBy} em ${formatDateTime(group.updatedAt)}` : ""}</small>
        </div>
      </div>
    </article>
  );
}

export default function GruposPage() {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [groups, setGroups] = useState<Group[]>([]);
  const [ungrouped, setUngrouped] = useState<GroupRnc[]>([]);
  const [total, setTotal] = useState(0);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [outlook, setOutlook] = useState({ configured: false, connected: false });
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [response, base] = await Promise.all([fetch("/api/rnc-groups", { cache: "no-store" }), fetch("/api/rncs", { cache: "no-store" })]);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os grupos.");
      setGroups(data.groups as Group[]);
      setUngrouped(data.ungrouped as GroupRnc[]);
      setTotal(data.totalReprovadas as number);
      setAccessUser(data.user || null);
      const baseData = await base.json().catch(() => ({}));
      if (baseData.works) setWorks(baseData.works);
      if ("activeWorkId" in baseData) setActiveWorkId(baseData.activeWorkId ?? null);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível carregar os grupos.");
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

  async function createGroup() {
    const name = window.prompt("Nome do novo grupo:");
    if (!name?.trim()) return;
    try {
      await request("/api/rnc-groups", { method: "POST", body: JSON.stringify({ name }) });
      await load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível criar o grupo.");
    }
  }

  const groupedCount = total - ungrouped.length;
  const today = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(new Date());

  return (
    <div className="app-shell">
      <Topbar activeUser={accessUser} collapsed={collapsed} onToggleCollapse={toggleCollapsed} works={works} activeWorkId={activeWorkId} onSelectWork={selectWork} />
      <Sidebar canCreateRnc={accessUser?.role === "admin"} outlook={outlook} syncing={false} collapsed={collapsed} onToggleCollapse={toggleCollapsed}
        onSync={() => { window.location.href = "/"; }} onNewRnc={() => { window.location.href = "/"; }}
        onExportExcel={() => { window.location.href = "/"; }} onExportPdf={() => { window.location.href = "/"; }} />
      <main className="app-main">
        <section className="page-heading rp-heading">
          <div>
            <p className="eyebrow">Acompanhamento · {today}</p>
            <h1>Grupos de RNCs Reprovadas</h1>
            <p>Resumo dos grupos, as RNCs de cada um e seus comentários. Renomeie os grupos e comente direto nesta página.</p>
          </div>
          <div className="rp-actions rj-noprint">
            <a className="button secondary" href="/reprovadas"><ArrowLeft size={14} /> Voltar às reprovadas</a>
            <button type="button" className="button secondary" onClick={() => void createGroup()}><Plus size={14} /> Novo grupo</button>
            <button type="button" className="button secondary" onClick={() => window.print()}><Printer size={14} /> Imprimir / PDF</button>
            <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Atualizando…" : "Atualizar"}</button>
          </div>
        </section>
        <section className="rp-page">
          {error && <div className="rp-error" role="alert">{error}</div>}

          <div className="rp-cards">
            <div className="rp-card"><span>Grupos</span><strong>{groups.length}</strong></div>
            <div className="rp-card"><span>RNCs reprovadas</span><strong>{total}</strong></div>
            <div className="rp-card"><span>Agrupadas</span><strong>{groupedCount}</strong></div>
            <div className="rp-card"><span>Sem grupo</span><strong>{ungrouped.length}</strong></div>
          </div>

          <div className="rp-panel">
            <header className="rp-panel-head"><div><h2>Resumo</h2><p>Quantas RNCs e quais estão em cada grupo.</p></div></header>
            {groups.length || ungrouped.length ? (
              <div className="rp-table-wrap">
                <table className="rp-table gr-summary">
                  <thead><tr><th>Grupo</th><th>Qtd.</th><th>RNCs</th></tr></thead>
                  <tbody>
                    {groups.map((group) => (
                      <tr key={group.id}>
                        <td><strong>{group.name}</strong></td>
                        <td>{group.rncs.length}</td>
                        <td>{group.rncs.map(label).join(", ") || "—"}</td>
                      </tr>
                    ))}
                    {ungrouped.length > 0 && (
                      <tr className="gr-ungrouped-row">
                        <td><strong>Sem grupo</strong></td>
                        <td>{ungrouped.length}</td>
                        <td>{ungrouped.map(label).join(", ")}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : <p className="rp-empty">{loading ? "Carregando dados…" : "Ainda não há grupos. Na página Reprovadas, use “Sugerir grupos por assunto” ou marque RNCs e crie um grupo."}</p>}
          </div>

          {groups.map((group) => (
            <GroupCard key={`${group.id}-${group.updatedAt}`} group={group} onChanged={load} onError={setError} />
          ))}

          {ungrouped.length > 0 && (
            <article className="gr-card gr-card-muted">
              <header className="gr-card-head"><h3>Sem grupo</h3><span className="gr-count">{ungrouped.length} {ungrouped.length === 1 ? "RNC" : "RNCs"}</span></header>
              <ul className="gr-rncs">
                {ungrouped.map((rnc) => <li key={rnc.id}><strong>{label(rnc)}</strong><span>{rnc.description}</span></li>)}
              </ul>
            </article>
          )}
        </section>
      </main>
    </div>
  );
}
