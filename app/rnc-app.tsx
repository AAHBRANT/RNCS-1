"use client";

import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";

type Work = { id: number; name: string };
type Rnc = {
  id: number; workId: number; workName: string; number: string; year: number;
  description: string; type: string; receivedAt: string | null; dueAt: string | null;
  sentAt: string | null; returnedAt: string | null; status: string; notes: string;
  responseOwner: string; analysisOwner: string; updatedAt: string;
  fieldSources: string; fieldConfidence: string; manualFields: string; sourceSummary: string;
};
type Audit = { id: number; field: string; oldValue: string | null; newValue: string | null; changedAt: string; userName: string };
type EmailEvent = { id: number; eventType: string; sender: string | null; recipients: string | null; subject: string | null; summary: string | null; occurredAt: string; folderName: string | null; attachmentMetadata: string | null; conversationId?: string | null; internetMessageId?: string | null; inReplyTo?: string | null; references?: string | null; associationConfidence?: number };
type AttachmentAudit = {
  id: string; name: string; contentType: string; size: number; extractionMethod?: string;
  extractedText?: string; pageCount?: number; needsOcr?: boolean; processingError?: string | null;
  identifiedRncNumber?: string | null; identifiedYear?: number | null;
  identifiedResponsible?: string | null; identifiedStatus?: string | null;
  matchedStatusText?: string | null; processedAt?: string;
};
type Conflict = { id: number; field: string; candidateValues: string; status: string };
type OutlookStatus = {
  configured: boolean;
  connected: boolean;
  connection?: { lastSyncAt?: string | null; lastSyncMessage?: string | null };
};
type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };

const statusOptions = ["Recebida", "Em elaboração", "Respondida", "Aprovada", "Reprovada", "Reaberta", "Retorno recebido — status a confirmar", "Não identificado"];
const typeOptions = ["Segurança do Trabalho", "Ambiental", "Qualidade", "Projeto", "Execução", "Documental", "Outro", "A classificar"];
const labelByField: Record<string, string> = {
  registro: "Registro", workId: "Obra", number: "Nº RNC", year: "Ano",
  description: "Descrição", type: "Tipo", receivedAt: "Recebimento", dueAt: "Prazo",
  sentAt: "Envio", returnedAt: "Retorno", status: "Status", notes: "Observações",
  responseOwner: "Responsável pela resposta", analysisOwner: "Responsável pela análise",
};

function parseLocal(value: string) { return new Date(`${value}T12:00:00`); }
function fmt(value?: string | null) {
  if (!value) return "—";
  const date = value.length === 10 ? parseLocal(value) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

function attachmentsFromEvent(event: EmailEvent) {
  try { return JSON.parse(event.attachmentMetadata || "[]") as AttachmentAudit[]; }
  catch { return []; }
}
function businessDayDelta(fromValue: string, toValue: string) {
  const from = parseLocal(fromValue); const to = parseLocal(toValue);
  const direction = to >= from ? 1 : -1; let count = 0; const cursor = new Date(from);
  while ((direction === 1 && cursor < to) || (direction === -1 && cursor > to)) {
    cursor.setDate(cursor.getDate() + direction);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count += direction;
  }
  return count;
}
function todayInBrazil() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
function hasAnsweredStatus(rnc: Rnc) {
  return [
    "Respondida",
    "Aprovada",
    "Reprovada",
    "Retorno recebido — status a confirmar",
  ].includes(rnc.status);
}
function hasBeenAnswered(rnc: Rnc) {
  return Boolean(rnc.sentAt) || hasAnsweredStatus(rnc);
}
function deadlineResult(rnc: Rnc) {
  if (!rnc.dueAt) {
    return { delta: null, label: "Prazo não identificado" };
  }
  const comparison = rnc.sentAt || todayInBrazil();
  const delta = businessDayDelta(rnc.dueAt, comparison);
  if (rnc.sentAt) {
    if (delta === 0) return { delta, label: "Respondida no prazo" };
    if (delta > 0) return { delta, label: `Respondida com ${delta} ${delta === 1 ? "dia útil" : "dias úteis"} de atraso` };
    const early = Math.abs(delta);
    return { delta, label: `Respondida ${early} ${early === 1 ? "dia útil" : "dias úteis"} antes do prazo` };
  }
  if (hasAnsweredStatus(rnc)) {
    return { delta: 0, label: "Respondida — data do envio não identificada" };
  }
  if (delta > 0) return { delta, label: `${delta} ${delta === 1 ? "dia útil" : "dias úteis"} em atraso` };
  if (delta === 0) return { delta, label: "Vence hoje" };
  const remaining = Math.abs(delta);
  return { delta, label: `${remaining} ${remaining === 1 ? "dia útil" : "dias úteis"} restantes` };
}
function urgency(rnc: Rnc) {
  if (rnc.status === "Aprovada") return "approved";
  if (rnc.status === "Reprovada") return "rejected";
  if (rnc.sentAt) return (deadlineResult(rnc).delta ?? 0) > 0 ? "answered-late" : "answered";
  if (hasAnsweredStatus(rnc)) return "answered";
  if (rnc.status === "Não identificado" || rnc.type === "A classificar") return "unclassified";
  const delta = deadlineResult(rnc).delta;
  if (delta === null) return "unclassified";
  if (delta > 0) return "overdue";
  if (delta >= -2) return "warning";
  return "normal";
}

export function RncApp() {
  const [works, setWorks] = useState<Work[]>([]);
  const [rows, setRows] = useState<Rnc[]>([]);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [year, setYear] = useState("all");
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Rnc | null>(null);
  const [history, setHistory] = useState<Audit[]>([]);
  const [emails, setEmails] = useState<EmailEvent[]>([]);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [editing, setEditing] = useState<Rnc | null>(null);
  const [outlook, setOutlook] = useState<OutlookStatus>({ configured: false, connected: false });
  const [syncing, setSyncing] = useState(false);
  const [responding, setResponding] = useState<Rnc | null>(null);
  const [directive, setDirective] = useState("");
  const [updatedLabel, setUpdatedLabel] = useState("Carregando…");
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);

  async function load() {
    setBusy(true);
    const response = await fetch("/api/rncs");
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "Não foi possível carregar os dados.");
    else {
      setWorks(data.works);
      setRows(data.rncs);
      setAccessUser(data.user || null);
      setUpdatedLabel(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date()));
    }
    setBusy(false);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/rncs")
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) setNotice(data.error || "Não foi possível carregar os dados.");
        else {
          setWorks(data.works);
          setRows(data.rncs);
          setAccessUser(data.user || null);
          setUpdatedLabel(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date()));
        }
      })
      .catch(() => {
        if (active) setNotice("Não foi possível carregar os dados.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const oauthNotice = query.get("outlook") === "connected"
      ? "Outlook conectado com sucesso. Clique em Atualizar e-mails."
      : query.get("outlook") === "error"
        ? query.get("message") || "Não foi possível conectar o Outlook."
        : "";
    if (oauthNotice) queueMicrotask(() => setNotice(oauthNotice));
    if (query.has("outlook")) window.history.replaceState({}, "", window.location.pathname);
    fetch("/api/outlook/status")
      .then((response) => response.json())
      .then((data) => { if (!data.error) setOutlook(data); })
      .catch(() => undefined);
  }, []);

  async function syncEmails() {
    if (!outlook.connected) {
      window.location.href = "/api/outlook/connect";
      return;
    }
    setSyncing(true);
    try {
      // Reconcile returns already stored in the dossier before the heavier
      // Outlook/PDF pass. This keeps status cards accurate even when a large
      // attachment needs to be skipped or retried.
      await fetch("/api/rncs/reconcile-statuses", { method: "POST" });
      let cursor: string | undefined;
      let complete = false;
      let batches = 0;
      const totals = {
        messagesAnalyzed: 0, newRncs: 0, updatedRncs: 0, ownersIdentified: 0,
        sentDatesCorrected: 0, returnsProcessed: 0, statusesUpdated: 0,
      };
      while (!complete && batches < 500) {
        const response = await fetch("/api/outlook/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cursor }),
        });
        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json")
          ? await response.json()
          : { error: "Uma etapa da sincronização excedeu o tempo disponível. Clique novamente para tentar outra vez." };
        if (!response.ok) throw new Error(data.error || "Falha ao atualizar e-mails.");
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(data[key] || 0);
        cursor = data.nextCursor;
        complete = data.complete !== false;
        batches++;
        setNotice(data.message);
      }
      if (!complete) throw new Error("A sincronização atingiu o limite de etapas. Clique novamente para continuar.");
      const message = [
        `${totals.messagesAnalyzed} mensagens oficiais analisadas`,
        `${totals.newRncs} novas RNC encontradas`,
        `${totals.updatedRncs} RNC atualizadas`,
        `${totals.ownersIdentified} responsáveis identificados`,
        `${totals.sentDatesCorrected} datas de envio corrigidas`,
        `${totals.returnsProcessed} retornos processados`,
        `${totals.statusesUpdated} status atualizados`,
        "Sincronização concluída.",
      ].join(" · ");
      setNotice(message);
      setOutlook((current) => ({
        ...current,
        connection: { ...current.connection, lastSyncAt: new Date().toISOString(), lastSyncMessage: message },
      }));
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao atualizar e-mails.");
    } finally {
      setSyncing(false);
    }
  }

  const filtered = useMemo(() => rows.filter((r) => {
    const term = search.toLocaleLowerCase("pt-BR");
    const deadline = deadlineResult(r).delta;
    const cardMatches = cardFilter === "all"
      || (cardFilter === "received" && (r.status === "Recebida" || r.status === "Em elaboração"))
      || (cardFilter === "answered" && r.status === "Respondida")
      || (cardFilter === "approved" && r.status === "Aprovada")
      || (cardFilter === "rejected" && r.status === "Reprovada")
      || (cardFilter === "reopened" && r.status === "Reaberta")
      || (cardFilter === "pendingReview" && r.status === "Retorno recebido — status a confirmar")
      || (cardFilter === "onTime" && deadline !== null && deadline <= 0)
      || (cardFilter === "overdue" && !hasBeenAnswered(r) && (deadline ?? 0) > 0)
      || (cardFilter === "answeredLate" && !!r.sentAt && (deadline ?? 0) > 0);
    return cardMatches && (status === "all" || r.status === status)
      && (type === "all" || r.type === type)
      && (year === "all" || String(r.year) === year)
      && (!term || `${r.number} ${r.description} ${r.notes} ${r.responseOwner}`.toLocaleLowerCase("pt-BR").includes(term));
  }), [rows, status, type, year, search, cardFilter]);

  function clearFilters() {
    setStatus("all"); setType("all"); setYear("all"); setSearch(""); setCardFilter("all");
  }

  const stats = useMemo(() => ({
    total: rows.length,
    received: rows.filter((r) => r.status === "Recebida" || r.status === "Em elaboração").length,
    answered: rows.filter((r) => r.status === "Respondida").length,
    approved: rows.filter((r) => r.status === "Aprovada").length,
    rejected: rows.filter((r) => r.status === "Reprovada").length,
    reopened: rows.filter((r) => r.status === "Reaberta").length,
    pendingReview: rows.filter((r) => r.status === "Retorno recebido — status a confirmar").length,
    onTime: rows.filter((r) =>
      (!hasBeenAnswered(r) && deadlineResult(r).delta !== null && deadlineResult(r).delta! <= 0)
      || (!!r.sentAt && deadlineResult(r).delta !== null && deadlineResult(r).delta! <= 0)
    ).length,
    overdue: rows.filter((r) => !hasBeenAnswered(r) && (deadlineResult(r).delta ?? 0) > 0).length,
    answeredLate: rows.filter((r) => !!r.sentAt && (deadlineResult(r).delta ?? 0) > 0).length,
  }), [rows]);

  async function createRnc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    const response = await fetch("/api/rncs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error); return; }
    setNotice("RNC cadastrada com sucesso.");
    setShowForm(false); await load();
  }

  async function saveRnc(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const response = await fetch("/api/rncs", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: editing.id, ...payload }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error); return; }
    setNotice("Alterações salvas e registradas no histórico.");
    setEditing(null); setSelected(null); await load();
  }

  async function openDetails(rnc: Rnc) {
    setSelected(rnc); setHistory([]); setEmails([]); setConflicts([]);
    const response = await fetch(`/api/rncs/${rnc.id}/history`);
    if (response.ok) {
      const data = await response.json();
      setHistory(data.changes); setEmails(data.emails || []); setConflicts(data.conflicts || []);
    }
  }

  async function reprocessRnc(rnc: Rnc) {
    setSyncing(true);
    try {
      let cursor: string | undefined;
      let complete = false;
      let batches = 0;
      let message = "";
      while (!complete && batches < 100) {
        const response = await fetch(`/api/rncs/${rnc.id}/reprocess`, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cursor }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Falha ao reprocessar.");
        cursor = data.nextCursor;
        complete = data.complete !== false;
        message = data.message;
        batches++;
      }
      setNotice(message || "RNC reprocessada."); setSelected(null); await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao reprocessar.");
    } finally { setSyncing(false); }
  }

  function responseContext(rnc: Rnc) {
    return [
      `RNC ${rnc.number}/${rnc.year}`, `Obra: ${rnc.workName}`, `Descrição: ${rnc.description}`,
      `Tipo: ${rnc.type}`, `Recebimento: ${fmt(rnc.receivedAt)}`, `Prazo: ${fmt(rnc.dueAt)}`,
      `Responsável: ${rnc.responseOwner || "Não identificado"}`, `Status: ${rnc.status}`,
      `Diretriz para elaboração da resposta: ${directive}`,
      `Histórico oficial:\n${emails.map((event) => `- ${fmt(event.occurredAt)} — ${event.eventType}: ${event.subject || ""}`).join("\n") || "Sem eventos adicionais."}`,
      "Elabore uma minuta técnica para revisão. Não envie nenhum e-mail.",
    ].join("\n\n");
  }

  async function copyResponseContext() {
    if (!responding || !directive.trim()) { setNotice("Informe a diretriz para elaboração da resposta."); return; }
    await navigator.clipboard.writeText(responseContext(responding));
    setNotice("Informações copiadas. Cole-as no agente de RNC.");
  }

  function exportExcel() {
    const headers = ["ITEM", "Nº RNC", "ANO", "OBRA", "DESCRIÇÃO", "TIPO", "DATA DE RECEBIMENTO", "DATA PREVISTA PARA ENVIO", "DATA DO ENVIO", "DATA DE RETORNO", "STATUS", "OBSERVAÇÕES", "RESPONSÁVEL PELA RESPOSTA", "RESPONSÁVEL PELA ANÁLISE"];
    const body = filtered.map((r, i) => [i + 1, r.number, r.year, r.workName, r.description, r.type, fmt(r.receivedAt), fmt(r.dueAt), fmt(r.sentAt), fmt(r.returnedAt), r.status, r.notes, r.responseOwner, r.analysisOwner]);
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = "\ufeff" + [headers, ...body].map((line) => line.map(escape).join(";")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `controle-rncs-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(link.href);
  }

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);

  return (
    <main>
      <header className="topbar">
        <div className="brand"><Image className="brand-mark" src="/favicon-rnc.png" alt="RNC" width={39} height={39} priority /><div><strong>Controle de RNC</strong><small>Gestão de não conformidades</small></div></div>
        <div className="header-actions">
          {accessUser && <span className="user-chip"><strong>{accessUser.name}</strong><small>{accessUser.role === "admin" ? "Administradora" : accessUser.role === "drafter" ? "Elaborador" : "Revisor/Aprovador"}</small></span>}
          <span className="sync"><i /> {outlook.connected ? "Outlook conectado" : "Operação manual"}</span>
          <button className="button secondary" onClick={() => { window.location.href = "/responder"; }}>Elaborar respostas</button>
          <button
            className="button secondary"
            onClick={syncEmails}
            disabled={syncing || (!outlook.configured && !outlook.connected)}
            title={!outlook.configured ? "Configure as credenciais Microsoft na Vercel" : undefined}
          >
            {syncing ? "Atualizando…" : outlook.connected ? "↻ Atualizar e-mails" : "Conectar Outlook"}
          </button>
          {accessUser?.role === "admin" && <button className="button primary" onClick={() => setShowForm(true)}>＋ Nova RNC</button>}
          <a className="logout-link" href="/api/auth/logout">Sair</a>
        </div>
      </header>

      <section className="page-heading">
        <div><p className="eyebrow">Visão geral</p><h1>Relatórios de Não Conformidade</h1><p>Acompanhe prazos, respostas e retornos da Supervisão.</p></div>
        <div className="export-actions"><button onClick={exportExcel}>↓ Excel</button><button onClick={() => window.print()}>↓ PDF</button></div>
      </section>

      <p className="metric-group-label">Situação das RNCs — categorias exclusivas</p>
      <section className="metrics status-metrics">
        {[
          ["Total de RNC", stats.total, "neutral", "all"], ["Recebidas", stats.received, "amber", "received"],
          ["Respondidas · aguardando análise", stats.answered, "blue", "answered"], ["Aprovadas", stats.approved, "green", "approved"],
          ["Reprovadas", stats.rejected, "red", "rejected"], ["Reabertas", stats.reopened, "violet", "reopened"],
          ["Status a confirmar", stats.pendingReview, "orange", "pendingReview"],
        ].map(([label, value, tone, filter]) => <button type="button" key={String(label)} aria-pressed={cardFilter === filter} onClick={() => setCardFilter((current) => current === filter ? "all" : String(filter))} className={`metric ${tone} ${cardFilter === filter ? "active" : ""}`}><span>{label}</span><strong>{value}</strong><div className="metric-line" /></button>)}
      </section>
      <p className="metric-group-label">Cumprimento do prazo — categorias exclusivas</p>
      <section className="metrics deadline-metrics">
        {[
          ["Dentro do prazo", stats.onTime, "teal", "onTime"], ["Vencidas", stats.overdue, "red", "overdue"],
          ["Respondidas com atraso", stats.answeredLate, "orange", "answeredLate"],
        ].map(([label, value, tone, filter]) => <button type="button" key={String(label)} aria-pressed={cardFilter === filter} onClick={() => setCardFilter((current) => current === filter ? "all" : String(filter))} className={`metric ${tone} ${cardFilter === filter ? "active" : ""}`}><span>{label}</span><strong>{value}</strong><div className="metric-line" /></button>)}
      </section>

      <section className="workspace">
        <div className="filters">
          <label className="search"><span>⌕</span><input aria-label="Pesquisar RNC" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar número, descrição ou texto…" /></label>
          <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todos os status</option>{statusOptions.map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Filtrar por tipo" value={type} onChange={(e) => setType(e.target.value)}><option value="all">Todos os tipos</option>{typeOptions.map((t) => <option key={t}>{t}</option>)}</select>
          <select aria-label="Filtrar por ano" value={year} onChange={(e) => setYear(e.target.value)}><option value="all">Todos os anos</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
          <button className="button clear-filters" type="button" onClick={clearFilters}>Limpar filtros</button>
        </div>
        <div className="table-meta"><strong>{filtered.length} registros</strong><span>Atualização local: {updatedLabel}</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Nº RNC</th><th>Ano</th><th>Descrição</th><th>Tipo</th><th>Recebimento</th><th>Prazo de envio</th><th>Envio</th><th>Retorno</th><th>Status</th><th>Resp. pela resposta</th><th /></tr></thead>
            <tbody>
              {busy && <tr><td colSpan={12} className="empty">Carregando registros…</td></tr>}
              {!busy && !filtered.length && <tr><td colSpan={12} className="empty"><strong>Nenhuma RNC encontrada</strong><span>Cadastre a primeira RNC ou ajuste os filtros.</span></td></tr>}
              {filtered.map((r, index) => <tr key={r.id} className={`row-${urgency(r)}`} onClick={() => openDetails(r)}>
                <td className="item">{String(index + 1).padStart(2, "0")}</td><td><strong className="rnc-number">RNC {r.number}</strong><small>{r.workName}</small></td><td>{r.year}</td>
                <td className="description">{r.description}</td><td><span className="type-tag">{r.type}</span></td><td>{fmt(r.receivedAt)}</td>
                <td><strong>{fmt(r.dueAt)}</strong><small>{deadlineResult(r).label}</small></td>
                <td>{fmt(r.sentAt)}</td><td>{fmt(r.returnedAt)}</td><td><span className={`status status-${r.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-")}`}>{r.status}</span></td>
                <td>{r.responseOwner || "Não identificado"}</td><td className="row-actions">{r.status !== "Aprovada" && <button className="respond-button" onClick={(event) => { event.stopPropagation(); window.location.href = `/responder?rnc=${r.id}`; }}>Responder RNC</button>}<button className="dots" aria-label={`Abrir RNC ${r.number}`}>•••</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span>×</span></button>}
      {showForm && <Modal title="Cadastrar nova RNC" onClose={() => setShowForm(false)}><RncForm works={works} onSubmit={createRnc} /></Modal>}
      {editing && <Modal title={`Editar RNC ${editing.number}`} onClose={() => setEditing(null)}><RncForm works={works} rnc={editing} onSubmit={saveRnc} /></Modal>}
      {selected && <aside className="drawer">
        <div className="drawer-head"><div><span className="eyebrow">{selected.workName}</span><h2>RNC {selected.number}/{selected.year}</h2></div><button onClick={() => setSelected(null)}>×</button></div>
        <div className="drawer-body">
          <span className={`status status-${selected.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-")}`}>{selected.status}</span>
          <h3>{selected.description}</h3>
          <dl><div><dt>Tipo</dt><dd>{selected.type}</dd><small>{sourceFor(selected, "type")}</small><small className="confidence">{confidenceFor(selected, "type")}</small></div><div><dt>Recebimento</dt><dd>{fmt(selected.receivedAt)}</dd><small>{sourceFor(selected, "receivedAt")}</small><small className="confidence">{confidenceFor(selected, "receivedAt")}</small></div><div><dt>Prazo</dt><dd>{fmt(selected.dueAt)}</dd></div><div><dt>Envio</dt><dd>{fmt(selected.sentAt)}</dd><small>{sourceFor(selected, "sentAt")}</small><small className="confidence">{confidenceFor(selected, "sentAt")}</small></div><div><dt>Retorno</dt><dd>{fmt(selected.returnedAt)}</dd><small>{sourceFor(selected, "returnedAt")}</small><small className="confidence">{confidenceFor(selected, "returnedAt")}</small></div><div><dt>Status</dt><dd>{selected.status}</dd><small>{sourceFor(selected, "status")}</small><small className="confidence">{confidenceFor(selected, "status")}</small></div><div><dt>Resp. pela resposta</dt><dd>{selected.responseOwner || "Não identificado"}</dd><small>{sourceFor(selected, "responseOwner")}</small><small className="confidence">{confidenceFor(selected, "responseOwner")}</small></div><div><dt>Resp. pela análise</dt><dd>{selected.analysisOwner || "Não identificado"}</dd></div></dl>
          {conflicts.some((item) => item.status === "open") && <section className="conflict"><strong>Informações divergentes encontradas</strong><p>Revise os dados candidatos e selecione manualmente o valor correto.</p>{conflicts.filter((item) => item.status === "open").map((item) => <small key={item.id}>{item.field}: {JSON.parse(item.candidateValues).join(" · ")}</small>)}</section>}
          <section className="notes"><h4>Observações internas</h4><p>{selected.notes || "Nenhuma observação registrada."}</p></section>
          <section className="timeline"><h4>Dossiê e histórico oficial de e-mails</h4>{emails.length ? emails.map((event) => <div className="timeline-item" key={`email-${event.id}`}><i /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.subject}</p><small>{fmt(event.occurredAt)} · {event.folderName || "Outlook"}</small><small>Vínculo {"★".repeat(event.associationConfidence || 0)}{"☆".repeat(5 - (event.associationConfidence || 0))}{event.conversationId ? " · Conversation ID confirmado" : ""}</small>
            {attachmentsFromEvent(event).map((attachment) => <details className="attachment-audit" key={attachment.id}>
              <summary>{attachment.name} · {attachment.needsOcr ? "OCR necessário" : attachment.extractionMethod === "PDF_TEXT" ? `${attachment.pageCount || "?"} pág. · texto extraído` : "anexo registrado"}</summary>
              {attachment.processingError && <small>{attachment.processingError}</small>}
              {attachment.identifiedResponsible && <small>Responsável identificado: {attachment.identifiedResponsible}</small>}
              {attachment.identifiedStatus && <small>Status identificado: {attachment.identifiedStatus}{attachment.matchedStatusText ? ` (${attachment.matchedStatusText})` : ""}</small>}
              {attachment.identifiedRncNumber && <small>Documento: RNC {attachment.identifiedRncNumber}/{attachment.identifiedYear || selected.year}</small>}
              {attachment.extractedText && <pre>{attachment.extractedText}</pre>}
            </details>)}
          </div></div>) : <p className="muted">Nenhum e-mail oficial vinculado.</p>}</section>
          <section className="timeline"><h4>Histórico de alterações</h4>{history.length ? history.map((h) => <div className="timeline-item" key={h.id}><i /><div><strong>{labelByField[h.field] || h.field}</strong><p>{h.oldValue ? `${h.oldValue} → ` : ""}{h.newValue}</p><small>{fmt(h.changedAt)} · {h.userName}</small></div></div>) : <p className="muted">Nenhuma alteração manual adicional.</p>}</section>
        </div>
        {accessUser?.role === "admin" && <div className="drawer-footer split"><button className="button secondary" onClick={() => reprocessRnc(selected)} disabled={syncing}>Reprocessar RNC</button><button className="button primary" onClick={() => setEditing(selected)}>Editar RNC</button></div>}
      </aside>}
      {responding && responding.status !== "Aprovada" && <Modal title={`Responder RNC ${responding.number}/${responding.year}`} onClose={() => setResponding(null)}>
        <div className="response-panel">
          <div className="response-summary"><strong>{responding.workName}</strong><span>{responding.description}</span><small>Recebida em {fmt(responding.receivedAt)} · prazo {fmt(responding.dueAt)} · {responding.responseOwner || "Responsável não identificado"}</small></div>
          <label>Diretriz para elaboração da resposta<textarea value={directive} onChange={(event) => setDirective(event.target.value)} rows={6} required placeholder="Informe o que foi executado, quais documentos ou evidências serão apresentados, eventuais justificativas e o posicionamento que deverá ser adotado na resposta." /></label>
          <p className="guidance">Inclua fotografias, relatórios, PDFs, planilhas e demais evidências ao trabalhar no agente. O sistema não transfere automaticamente anexos para o ChatGPT.</p>
          <div className="form-actions"><button className="button secondary" onClick={copyResponseContext}>Copiar informações</button><a className="button primary link-button" href="https://chatgpt.com/g/g-6a0c7aace1708191ade1c78cfc4f70e8-relatorios-tecnicos-assistente" target="_blank" rel="noreferrer">Abrir agente de RNC</a></div>
        </div>
      </Modal>}
      {(selected || editing || showForm || responding) && <div className="backdrop" onClick={() => { setSelected(null); setEditing(null); setShowForm(false); setResponding(null); }} />}
    </main>
  );
}

function sourceFor(rnc: Rnc, field: string) {
  try { return (JSON.parse(rnc.fieldSources || "{}") as Record<string, string>)[field] || "Origem não registrada"; }
  catch { return "Origem não registrada"; }
}

function confidenceFor(rnc: Rnc, field: string) {
  try {
    const item = (JSON.parse(rnc.fieldConfidence || "{}") as Record<string, { score?: number; reason?: string }>)[field];
    if (!item) return "☆☆☆☆☆ · Confiança ainda não calculada";
    const score = Math.max(0, Math.min(5, Number(item.score || 0)));
    return `${"★".repeat(score)}${"☆".repeat(5 - score)} · ${item.reason || "Sem justificativa registrada"}`;
  } catch {
    return "☆☆☆☆☆ · Confiança ainda não calculada";
  }
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div>;
}

function RncForm({ works, rnc, onSubmit }: { works: Work[]; rnc?: Rnc; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const onlyWork = works[0];
  return <form className="rnc-form" onSubmit={onSubmit}>
    <label className="span-2">Obra<input value={onlyWork?.name || rnc?.workName || "Parque Socioambiental do Roger – Fase II"} disabled /><input type="hidden" name="workId" value={onlyWork?.id || rnc?.workId || ""} /></label>
    <label>Nº RNC<input name="number" defaultValue={rnc?.number} inputMode="numeric" placeholder="096" required /></label>
    <label>Ano<input name="year" defaultValue={rnc?.year || new Date().getFullYear()} type="number" min="2000" max="2100" required /></label>
    <label className="span-2">Descrição<input name="description" defaultValue={rnc?.description} placeholder="Descreva a não conformidade" /></label>
    <label>Tipo<select name="type" defaultValue={rnc?.type || "A classificar"}>{typeOptions.map((t) => <option key={t}>{t}</option>)}</select></label>
    <label>Status<select name="status" defaultValue={rnc?.status || "Recebida"}>{statusOptions.map((s) => <option key={s}>{s}</option>)}</select></label>
    <label>Data de recebimento<input name="receivedAt" type="date" defaultValue={rnc?.receivedAt || today} required /></label>
    {rnc && <><label>Data do envio<input name="sentAt" type="date" defaultValue={rnc.sentAt || ""} /></label><label>Data do retorno<input name="returnedAt" type="date" defaultValue={rnc.returnedAt || ""} /></label></>}
    <label className={rnc ? "" : "span-2"}>Responsável pela resposta<input name="responseOwner" defaultValue={rnc?.responseOwner} placeholder="Nome do responsável" /></label>
    <label className="span-2">Responsável pela análise<input name="analysisOwner" defaultValue={rnc?.analysisOwner} placeholder="Supervisão, UEP ou responsável" /></label>
    <label className="span-2">Observações<textarea name="notes" defaultValue={rnc?.notes} rows={3} placeholder="Comentários internos — preenchimento exclusivamente manual" /></label>
    <div className="form-actions span-2"><button className="button primary" type="submit">{rnc ? "Salvar alterações" : "Cadastrar RNC"}</button></div>
  </form>;
}
