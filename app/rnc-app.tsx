"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search, Star, X } from "lucide-react";
import { Sidebar } from "./components/sidebar";
import { Topbar } from "./components/topbar";
import { deadlineResult, fmt, hasAnsweredStatus, hasBeenAnswered } from "../lib/rnc-deadline";
import { useSidebarCollapse } from "../lib/use-sidebar-collapse";

export type Work = { id: number; name: string; accessible: boolean };
type Rnc = {
  id: number; workId: number; workName: string; number: string; year: number;
  description: string; type: string; receivedAt: string | null; dueAt: string | null;
  sentAt: string | null; returnedAt: string | null; inspectionDate: string | null; status: string; notes: string;
  responseOwner: string; inspectionOwner: string; contract: string; analysisOwner: string; updatedAt: string;
  issuedAt: string | null; serviceLocation: string;
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
export type OutlookStatus = {
  configured: boolean;
  connected: boolean;
  connection?: { lastSyncAt?: string | null; lastSyncMessage?: string | null };
};
export type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };
type OutlookDiagnosticEntry = {
  id: string; remetente: string; destinatarios: string[]; cc: string[]; assunto: string;
  temAnexos: boolean; motivo: string; nivel: "descarte" | "sucesso"; [extra: string]: unknown;
};

const statusOptions = ["Recebida", "Em elaboração", "Respondida", "Aprovada", "Reprovada", "Reaberta", "Retorno recebido — status a confirmar", "Não identificado"];
const defaultTypeOptions = ["Engenharia", "Segurança do Trabalho", "Ambiental", "Social", "A classificar"];
const PAGE_SIZE = 20;
const labelByField: Record<string, string> = {
  registro: "Registro", workId: "Obra", number: "Nº RNC", year: "Ano",
  description: "Descrição", type: "Tipo", receivedAt: "Recebimento", dueAt: "Prazo",
  sentAt: "Envio", returnedAt: "Retorno", inspectionDate: "Data da inspeção", status: "Status", notes: "Observações",
  responseOwner: "Responsável pela resposta", analysisOwner: "Responsável pela análise",
  inspectionOwner: "Responsável fiscal pela inspeção", contract: "Contrato",
};

function attachmentsFromEvent(event: EmailEvent) {
  try { return JSON.parse(event.attachmentMetadata || "[]") as AttachmentAudit[]; }
  catch { return []; }
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
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [works, setWorks] = useState<Work[]>([]);
  const [rows, setRows] = useState<Rnc[]>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [year, setYear] = useState("all");
  const [search, setSearch] = useState("");
  const [cardFilter, setCardFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [reclassifying, setReclassifying] = useState(false);
  const [reclassifyReport, setReclassifyReport] = useState<{
    analyzed: number; corrected: number; unchanged: number;
    needsManualReview: Array<{ id: number; number: string; year: number; previousType: string }>;
  } | null>(null);
  const [diagnosticsReport, setDiagnosticsReport] = useState<OutlookDiagnosticEntry[] | null>(null);
  const [showDiagnosticsModal, setShowDiagnosticsModal] = useState(false);
  const [diagnosticsFilter, setDiagnosticsFilter] = useState("");
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
  const [typeOptions, setTypeOptions] = useState(defaultTypeOptions);

  async function selectWork(id: number) {
    const response = await fetch(`/api/works/${id}/select`, { method: "POST" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setNotice(data.error || "Não foi possível trocar de obra.");
      return;
    }
    await load();
  }

  async function load() {
    setBusy(true);
    const response = await fetch("/api/rncs");
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "Não foi possível carregar os dados.");
    else {
      setWorks(data.works);
      setRows(data.rncs);
      setAccessUser(data.user || null);
      setActiveWorkId(data.activeWorkId || null);
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
          setActiveWorkId(data.activeWorkId || null);
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
  useEffect(() => {
    let active = true;
    fetch("/api/rncs/types")
      .then((response) => response.json())
      .then((data) => {
        if (active && data.types && Array.isArray(data.types)) {
          setTypeOptions(data.types);
        }
      })
      .catch(() => undefined);
    return () => { active = false; };
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
      const diagnostics: OutlookDiagnosticEntry[] = [];
      while (!complete && batches < 500) {
        // A serverless function that times out server-side can drop the connection
        // without ever sending a response. Without a client-side abort, fetch() waits
        // forever and the button stays stuck on "Atualizando…" with no error shown.
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 280_000);
        let response: Response;
        try {
          response = await fetch("/api/outlook/sync", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ cursor, diagnostics: true }),
            signal: controller.signal,
          });
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") {
            throw new Error("Uma etapa da sincronização excedeu o tempo limite do servidor. Clique novamente para continuar de onde parou.");
          }
          throw error;
        } finally {
          clearTimeout(timeout);
        }
        const contentType = response.headers.get("content-type") || "";
        const data = contentType.includes("application/json")
          ? await response.json()
          : { error: "Uma etapa da sincronização excedeu o tempo disponível. Clique novamente para tentar outra vez." };
        if (!response.ok) throw new Error(data.error || "Falha ao atualizar e-mails.");
        for (const key of Object.keys(totals) as Array<keyof typeof totals>) totals[key] += Number(data[key] || 0);
        if (Array.isArray(data.diagnostics)) diagnostics.push(...data.diagnostics);
        cursor = data.nextCursor;
        complete = data.complete !== false;
        batches++;
        setNotice(data.message);
      }
      if (!complete) throw new Error("A sincronização atingiu o limite de etapas. Clique novamente para continuar.");
      setDiagnosticsReport(diagnostics);
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
      || (cardFilter === "sentOnTime" && hasBeenAnswered(r) && deadline !== null && deadline <= 0)
      || (cardFilter === "pendingOnTime" && !hasBeenAnswered(r) && deadline !== null && deadline <= 0)
      || (cardFilter === "overdue" && !hasBeenAnswered(r) && (deadline ?? 0) > 0)
      || (cardFilter === "sentLate" && !!r.sentAt && (deadline ?? 0) > 0);
    return cardMatches && (status === "all" || r.status === status)
      && (type === "all" || r.type === type)
      && (year === "all" || String(r.year) === year)
      && (!term || `${r.number} ${r.description} ${r.notes} ${r.responseOwner}`.toLocaleLowerCase("pt-BR").includes(term));
  }), [rows, status, type, year, search, cardFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.min(currentPage, totalPages);
  const firstRecord = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRecord = Math.min(page * PAGE_SIZE, filtered.length);
  const paginated = filtered.slice(firstRecord ? firstRecord - 1 : 0, lastRecord);

  function clearFilters() {
    setStatus("all"); setType("all"); setYear("all"); setSearch(""); setCardFilter("all");
    setCurrentPage(1);
  }

  const stats = useMemo(() => ({
    total: rows.length,
    received: rows.filter((r) => r.status === "Recebida" || r.status === "Em elaboração").length,
    answered: rows.filter((r) => r.status === "Respondida").length,
    approved: rows.filter((r) => r.status === "Aprovada").length,
    rejected: rows.filter((r) => r.status === "Reprovada").length,
    reopened: rows.filter((r) => r.status === "Reaberta").length,
    pendingReview: rows.filter((r) => r.status === "Retorno recebido — status a confirmar").length,
    sentOnTime: rows.filter((r) => hasBeenAnswered(r) && deadlineResult(r).delta !== null && deadlineResult(r).delta! <= 0).length,
    pendingOnTime: rows.filter((r) => !hasBeenAnswered(r) && deadlineResult(r).delta !== null && deadlineResult(r).delta! <= 0).length,
    overdue: rows.filter((r) => !hasBeenAnswered(r) && (deadlineResult(r).delta ?? 0) > 0).length,
    sentLate: rows.filter((r) => !!r.sentAt && (deadlineResult(r).delta ?? 0) > 0).length,
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
    const headers = ["ITEM", "Nº RNC", "ANO", "OBRA", "DESCRIÇÃO", "TIPO", "DATA DE RECEBIMENTO", "DATA PREVISTA PARA ENVIO", "DATA DO ENVIO", "DATA DE RETORNO", "STATUS", "OBSERVAÇÕES", "RESPONSÁVEL DA ÁREA INSPECIONADA", "RESPONSÁVEL PELA ANÁLISE"];
    const body = filtered.map((r, i) => [i + 1, r.number, r.year, r.workName, r.description, r.type, fmt(r.receivedAt), fmt(r.dueAt), fmt(r.sentAt), fmt(r.returnedAt), r.status, r.notes, r.responseOwner, r.analysisOwner]);
    const escape = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = "\ufeff" + [headers, ...body].map((line) => line.map(escape).join(";")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `controle-rncs-${new Date().toISOString().slice(0, 10)}.csv`; link.click();
    URL.revokeObjectURL(link.href);
  }

  async function reclassifyTypes() {
    setReclassifying(true);
    try {
      const response = await fetch("/api/rncs/reclassify-types", { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao reclassificar os tipos.");
      setReclassifyReport(data);
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao reclassificar os tipos.");
    } finally {
      setReclassifying(false);
    }
  }

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a);
  const activeWork = activeWorkId ? works.find((w) => w.id === activeWorkId) : null;

  return (
    <div className="app-shell">
      <Topbar activeUser={accessUser} collapsed={collapsed} onToggleCollapse={toggleCollapsed} works={works} activeWorkId={activeWorkId} onSelectWork={selectWork} />
      <Sidebar activeWorkName={activeWork?.name || null} canCreateRnc={accessUser?.role === "admin"} outlook={outlook} syncing={syncing} collapsed={collapsed} onToggleCollapse={toggleCollapsed} onSync={syncEmails} onNewRnc={() => setShowForm(true)} onExportExcel={exportExcel} onExportPdf={() => window.print()} canReclassifyTypes={accessUser?.role === "admin"} reclassifying={reclassifying} onReclassifyTypes={reclassifyTypes} />
      <main className="app-main">
      <section className="page-heading">
        <div><p className="eyebrow">Visão geral</p><h1>Relatórios de Não Conformidade</h1><p>Acompanhe prazos, respostas e retornos da Supervisão.</p></div>
        {accessUser?.role === "admin" && diagnosticsReport && (
          <button className="button secondary" onClick={() => setShowDiagnosticsModal(true)}>
            Ver diagnóstico técnico ({diagnosticsReport.length})
          </button>
        )}
      </section>

      <p className="metric-group-label">Situação das RNCs — categorias exclusivas</p>
      <section className="metrics status-metrics">
        {[
          ["Total de RNC", stats.total, "neutral", "all"], ["Recebidas", stats.received, "amber", "received"],
          ["Respondidas · aguardando análise", stats.answered, "blue", "answered"], ["Aprovadas", stats.approved, "green", "approved"],
          ["Reprovadas", stats.rejected, "red", "rejected"], ["Reabertas", stats.reopened, "violet", "reopened"],
          ["Status a confirmar", stats.pendingReview, "orange", "pendingReview"],
        ].map(([label, value, tone, filter]) => <button type="button" key={String(label)} aria-pressed={cardFilter === filter} onClick={() => { setCardFilter((current) => current === filter ? "all" : String(filter)); setCurrentPage(1); }} className={`metric ${tone} ${cardFilter === filter ? "active" : ""}`}><span>{label}</span><strong>{value}</strong><div className="metric-line" /></button>)}
      </section>
      <p className="metric-group-label">Cumprimento do prazo — categorias exclusivas</p>
      <section className="metrics deadline-metrics">
        {[
          ["Enviadas dentro do prazo", stats.sentOnTime, "teal", "sentOnTime"],
          ["Ainda dentro do prazo (não enviadas)", stats.pendingOnTime, "blue", "pendingOnTime"],
          ["Enviadas fora do prazo", stats.sentLate, "orange", "sentLate"],
          ["Vencidas sem resposta", stats.overdue, "red", "overdue"],
        ].map(([label, value, tone, filter]) => <button type="button" key={String(label)} aria-pressed={cardFilter === filter} onClick={() => { setCardFilter((current) => current === filter ? "all" : String(filter)); setCurrentPage(1); }} className={`metric ${tone} ${cardFilter === filter ? "active" : ""}`}><span>{label}</span><strong>{value}</strong><div className="metric-line" /></button>)}
      </section>

      <section className="workspace">
        <div className="filters">
          <label className="search"><span><Search size={16} /></span><input aria-label="Pesquisar RNC" value={search} onChange={(e) => { setSearch(e.target.value); setCurrentPage(1); }} placeholder="Pesquisar número, descrição ou texto…" /></label>
          <select aria-label="Filtrar por status" value={status} onChange={(e) => { setStatus(e.target.value); setCurrentPage(1); }}><option value="all">Todos os status</option>{statusOptions.map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Filtrar por tipo" value={type} onChange={(e) => { setType(e.target.value); setCurrentPage(1); }}><option value="all">Todos os tipos</option>{typeOptions.map((t) => <option key={t}>{t}</option>)}</select>
          <select aria-label="Filtrar por ano" value={year} onChange={(e) => { setYear(e.target.value); setCurrentPage(1); }}><option value="all">Todos os anos</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
          <button className="button clear-filters" type="button" onClick={clearFilters}>Limpar filtros</button>
        </div>
        <div className="table-meta"><strong>Exibindo {firstRecord}–{lastRecord} de {filtered.length} registros</strong><span>Atualização local: {updatedLabel}</span></div>
        <div className="table-scroll">
          <table>
            <colgroup>
              <col style={{ width: "2%" }} /><col style={{ width: "9%" }} /><col style={{ width: "3%" }} />
              <col style={{ width: "20%" }} /><col style={{ width: "6%" }} /><col style={{ width: "6%" }} />
              <col style={{ width: "7%" }} /><col style={{ width: "6%" }} /><col style={{ width: "6%" }} />
              <col style={{ width: "6%" }} /><col style={{ width: "7%" }} /><col style={{ width: "12%" }} />
              <col style={{ width: "10%" }} />
            </colgroup>
            <thead><tr><th>Item</th><th>Nº RNC</th><th>Ano</th><th>Descrição</th><th>Tipo</th><th>Recebimento</th><th>Prazo de envio</th><th>Envio</th><th>Retorno</th><th>Data da inspeção</th><th>Status</th><th>Responsável da área inspecionada</th><th /></tr></thead>
            <tbody>
              {busy && <tr><td colSpan={13} className="empty">Carregando registros…</td></tr>}
              {!busy && !filtered.length && <tr><td colSpan={13} className="empty"><strong>Nenhuma RNC encontrada</strong><span>Cadastre a primeira RNC ou ajuste os filtros.</span></td></tr>}
              {paginated.map((r, index) => <tr key={r.id} className={`row-${urgency(r)}`} onClick={() => openDetails(r)}>
                <td className="item">{String((page - 1) * PAGE_SIZE + index + 1).padStart(2, "0")}</td><td><strong className="rnc-number">RNC {r.number}</strong><small className="work-name">{r.workName}</small></td><td>{r.year}</td>
                <td className="description">{r.description}</td><td><span className="type-tag">{r.type}</span></td><td>{fmt(r.receivedAt)}</td>
                <td><strong>{fmt(r.dueAt)}</strong><small>{deadlineResult(r).label}</small></td>
                <td>{fmt(r.sentAt)}</td><td>{fmt(r.returnedAt)}</td><td>{fmt(r.inspectionDate)}</td><td><span className={`status status-${r.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-")}`}>{r.status}</span></td>
                <td>{r.responseOwner || "Não identificado"}</td><td className="row-actions">{r.status !== "Aprovada" && <button className="respond-button" onClick={(event) => { event.stopPropagation(); window.location.href = `/responder/editor?rnc=${r.id}`; }}>Responder RNC</button>}<button className="dots" aria-label={`Abrir RNC ${r.number}`}>•••</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_SIZE && <nav className="pagination" aria-label="Paginação das RNCs">
          <button type="button" disabled={page === 1} onClick={() => setCurrentPage(page - 1)}><ChevronLeft size={14} /> Anterior</button>
          <span>Página <strong>{page}</strong> de {totalPages}</span>
          <button type="button" disabled={page === totalPages} onClick={() => setCurrentPage(page + 1)}>Próxima <ChevronRight size={14} /></button>
        </nav>}
      </section>

      {notice && <button className="toast" onClick={() => setNotice("")}>{notice}<span><X size={14} /></span></button>}
      {reclassifyReport && <Modal title="Relatório de reclassificação de tipos" onClose={() => setReclassifyReport(null)}>
        <div className="reclassify-report">
          <p><strong>{reclassifyReport.analyzed}</strong> RNC(s) analisada(s)</p>
          <p><strong>{reclassifyReport.corrected}</strong> corrigida(s)</p>
          <p><strong>{reclassifyReport.unchanged}</strong> permaneceram inalteradas</p>
          {reclassifyReport.needsManualReview.length > 0 && (
            <>
              <h4>Precisam de revisão manual</h4>
              <ul>
                {reclassifyReport.needsManualReview.map((item) => (
                  <li key={item.id}>RNC {item.number}/{item.year} — tipo atual: {item.previousType || "(vazio)"}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </Modal>}
      {showDiagnosticsModal && diagnosticsReport && (() => {
        const term = diagnosticsFilter.trim().toLocaleLowerCase("pt-BR");
        const filtered = !term ? diagnosticsReport : diagnosticsReport.filter((entry) =>
          `${entry.assunto} ${entry.remetente} ${entry.motivo} ${entry.cc.join(" ")} ${entry.destinatarios.join(" ")}`
            .toLocaleLowerCase("pt-BR").includes(term));
        const successCount = diagnosticsReport.filter((entry) => entry.nivel === "sucesso").length;
        return (
          <Modal title="Diagnóstico da sincronização" onClose={() => setShowDiagnosticsModal(false)}>
            <div className="reclassify-report diagnostics-report">
              <p><strong>{successCount}</strong> mensagem(ns) processada(s) com sucesso · <strong>{diagnosticsReport.length - successCount}</strong> descartada(s)</p>
              <input
                className="diagnostics-search"
                placeholder="Filtrar por assunto, remetente, CC ou motivo…"
                value={diagnosticsFilter}
                onChange={(event) => setDiagnosticsFilter(event.target.value)}
              />
              <ul className="diagnostics-list">
                {filtered.map((entry, index) => (
                  <li key={`${entry.id}-${index}`} className={entry.nivel === "sucesso" ? "success" : "discard"}>
                    <strong>{entry.assunto || "(sem assunto)"}</strong>
                    <span className="diagnostics-badge">{entry.nivel === "sucesso" ? "sucesso" : "descarte"}</span>
                    <small>De: {entry.remetente} · Para: {entry.destinatarios.join(", ") || "—"}{entry.cc.length ? ` · CC: ${entry.cc.join(", ")}` : ""}</small>
                    <p>{entry.motivo}</p>
                  </li>
                ))}
                {!filtered.length && <li>Nenhum registro encontrado para esse filtro.</li>}
              </ul>
            </div>
          </Modal>
        );
      })()}
      {showForm && <Modal title="Cadastrar nova RNC" onClose={() => setShowForm(false)}><RncForm works={works} typeOptions={typeOptions} activeWorkId={activeWorkId} onSubmit={createRnc} /></Modal>}
      {editing && <Modal title={`Editar RNC ${editing.number}`} onClose={() => setEditing(null)}><RncForm works={works} typeOptions={typeOptions} rnc={editing} activeWorkId={activeWorkId} onSubmit={saveRnc} /></Modal>}
      {selected && <aside className="drawer">
        <div className="drawer-head"><div><span className="eyebrow">{selected.workName}</span><h2>RNC {selected.number}/{selected.year}</h2></div><button onClick={() => setSelected(null)}><X size={18} /></button></div>
        <div className="drawer-body">
          <span className={`status status-${selected.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-")}`}>{selected.status}</span>
          <h3>{selected.description}</h3>
          <dl><div><dt>Tipo</dt><dd>{selected.type}</dd><small>{sourceFor(selected, "type")}</small></div><div><dt>Recebimento</dt><dd>{fmt(selected.receivedAt)}</dd><small>{sourceFor(selected, "receivedAt")}</small></div><div><dt>Prazo</dt><dd>{fmt(selected.dueAt)}</dd></div><div><dt>Envio</dt><dd>{fmt(selected.sentAt)}</dd><small>{sourceFor(selected, "sentAt")}</small></div><div><dt>Retorno</dt><dd>{fmt(selected.returnedAt)}</dd><small>{sourceFor(selected, "returnedAt")}</small></div><div><dt>Data da inspeção</dt><dd>{fmt(selected.inspectionDate)}</dd><small>{sourceFor(selected, "inspectionDate")}</small></div><div><dt>Status</dt><dd>{selected.status}</dd><small>{sourceFor(selected, "status")}</small></div><div><dt>Responsável da área inspecionada</dt><dd>{selected.responseOwner || "Não identificado"}</dd><small>{sourceFor(selected, "responseOwner")}</small></div><div><dt>Responsável fiscal pela inspeção</dt><dd>{selected.inspectionOwner || "Não identificado"}</dd><small>{sourceFor(selected, "inspectionOwner")}</small></div><div><dt>Contrato</dt><dd>{selected.contract || "Não identificado"}</dd><small>{sourceFor(selected, "contract")}</small></div><div><dt>Data de emissão da tratativa</dt><dd>{fmt(selected.issuedAt)}</dd><small>{sourceFor(selected, "issuedAt")}</small></div><div><dt>Local/frente de serviço</dt><dd>{selected.serviceLocation || "Não identificado"}</dd><small>{sourceFor(selected, "serviceLocation")}</small></div>{selected.analysisOwner && <div><dt>Resp. pela análise</dt><dd>{selected.analysisOwner}</dd></div>}</dl>
          {conflicts.some((item) => item.status === "open") && <section className="conflict"><strong>Informações divergentes encontradas</strong><p>Revise os dados candidatos e selecione manualmente o valor correto.</p>{conflicts.filter((item) => item.status === "open").map((item) => <small key={item.id}>{item.field}: {JSON.parse(item.candidateValues).join(" · ")}</small>)}</section>}
          <section className="notes"><h4>Observações internas</h4><p>{selected.notes || "Nenhuma observação registrada."}</p></section>
          <section className="timeline"><h4>Dossiê e histórico oficial de e-mails</h4>{emails.length ? emails.map((event) => <div className="timeline-item" key={`email-${event.id}`}><i /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p>{event.subject}</p><small>{fmt(event.occurredAt)} · {event.folderName || "Outlook"}</small><small className="confidence-stars">Vínculo {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={12} fill={i < (event.associationConfidence || 0) ? "currentColor" : "none"} />)}{event.conversationId ? " · Conversation ID confirmado" : ""}</small>
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
    </div>
  );
}

function sourceFor(rnc: Rnc, field: string) {
  try { return (JSON.parse(rnc.fieldSources || "{}") as Record<string, string>)[field] || "Origem não registrada"; }
  catch { return "Origem não registrada"; }
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}><X size={18} /></button></div>{children}</div>;
}

function RncForm({ works, typeOptions, rnc, activeWorkId, onSubmit }: { works: Work[]; typeOptions: string[]; rnc?: Rnc; activeWorkId: number | null; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  const defaultWork = activeWorkId ? works.find((w) => w.id === activeWorkId) : works[0];
  return <form className="rnc-form" onSubmit={onSubmit}>
    <label className="span-2">Obra<input value={defaultWork?.name || rnc?.workName || ""} disabled /><input type="hidden" name="workId" value={defaultWork?.id || rnc?.workId || ""} /></label>
    <label>Nº RNC<input name="number" defaultValue={rnc?.number} inputMode="numeric" placeholder="096" required /></label>
    <label>Ano<input name="year" defaultValue={rnc?.year || new Date().getFullYear()} type="number" min="2000" max="2100" required /></label>
    <label className="span-2">Descrição<input name="description" defaultValue={rnc?.description} placeholder="Descreva a não conformidade" /></label>
    <label>Tipo<select name="type" defaultValue={rnc?.type || "A classificar"}>{typeOptions.map((t) => <option key={t}>{t}</option>)}</select></label>
    <label>Status<select name="status" defaultValue={rnc?.status || "Recebida"}>{statusOptions.map((s) => <option key={s}>{s}</option>)}</select></label>
    <label>Data de recebimento<input name="receivedAt" type="date" defaultValue={rnc?.receivedAt || today} required /></label>
    {rnc && <><label>Data do envio<input name="sentAt" type="date" defaultValue={rnc.sentAt || ""} /></label><label>Data do retorno<input name="returnedAt" type="date" defaultValue={rnc.returnedAt || ""} /></label></>}
    <label className="span-2">Observações<textarea name="notes" defaultValue={rnc?.notes} rows={3} placeholder="Comentários internos — preenchimento exclusivamente manual" /></label>
    <div className="form-actions span-2"><button className="button primary" type="submit">{rnc ? "Salvar alterações" : "Cadastrar RNC"}</button></div>
  </form>;
}
