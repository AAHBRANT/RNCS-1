"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Work = { id: number; name: string };
type Rnc = {
  id: number; workId: number; workName: string; number: string; year: number;
  description: string; type: string; receivedAt: string; dueAt: string;
  sentAt: string | null; returnedAt: string | null; status: string; notes: string;
  responseOwner: string; analysisOwner: string; updatedAt: string;
};
type Audit = { id: number; field: string; oldValue: string | null; newValue: string | null; changedAt: string; userName: string };

const statusOptions = ["Recebida", "Em elaboração", "Respondida", "Aprovada", "Reprovada", "Reaberta", "Não identificado"];
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
function businessDaysUntil(dateValue: string) {
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const target = parseLocal(dateValue);
  const direction = target >= today ? 1 : -1;
  let count = 0; const cursor = new Date(today);
  while ((direction === 1 && cursor < target) || (direction === -1 && cursor > target)) {
    cursor.setDate(cursor.getDate() + direction);
    if (cursor.getDay() !== 0 && cursor.getDay() !== 6) count += direction;
  }
  return count;
}
function urgency(rnc: Rnc) {
  if (rnc.status === "Aprovada") return "approved";
  if (rnc.status === "Reprovada") return "rejected";
  if (rnc.status === "Respondida") return "answered";
  if (rnc.status === "Não identificado" || rnc.type === "A classificar") return "unclassified";
  const remaining = businessDaysUntil(rnc.dueAt);
  if (remaining < 0) return "overdue";
  if (remaining <= 2) return "warning";
  return "normal";
}

export function RncApp() {
  const [works, setWorks] = useState<Work[]>([]);
  const [rows, setRows] = useState<Rnc[]>([]);
  const [selectedWork, setSelectedWork] = useState("all");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [year, setYear] = useState("all");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Rnc | null>(null);
  const [history, setHistory] = useState<Audit[]>([]);
  const [editing, setEditing] = useState<Rnc | null>(null);

  async function load() {
    setBusy(true);
    const response = await fetch("/api/rncs");
    const data = await response.json();
    if (!response.ok) setNotice(data.error || "Não foi possível carregar os dados.");
    else { setWorks(data.works); setRows(data.rncs); }
    setBusy(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((r) => {
    const term = search.toLocaleLowerCase("pt-BR");
    return (selectedWork === "all" || String(r.workId) === selectedWork)
      && (status === "all" || r.status === status)
      && (type === "all" || r.type === type)
      && (year === "all" || String(r.year) === year)
      && (!term || `${r.number} ${r.description} ${r.notes} ${r.responseOwner}`.toLocaleLowerCase("pt-BR").includes(term));
  }), [rows, selectedWork, status, type, year, search]);

  const stats = useMemo(() => ({
    total: rows.length,
    received: rows.filter((r) => r.status === "Recebida" || r.status === "Em elaboração").length,
    answered: rows.filter((r) => r.status === "Respondida").length,
    approved: rows.filter((r) => r.status === "Aprovada").length,
    rejected: rows.filter((r) => r.status === "Reprovada").length,
    reopened: rows.filter((r) => r.status === "Reaberta").length,
    onTime: rows.filter((r) => urgency(r) !== "overdue" || !!r.sentAt).length,
    overdue: rows.filter((r) => urgency(r) === "overdue" && !r.sentAt).length,
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
    setSelected(rnc); setHistory([]);
    const response = await fetch(`/api/rncs/${rnc.id}/history`);
    if (response.ok) setHistory((await response.json()).changes);
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
        <div className="brand"><span className="brand-mark">RN</span><div><strong>Controle de RNC</strong><small>Gestão de não conformidades</small></div></div>
        <div className="header-actions">
          <span className="sync"><i /> Operação manual</span>
          <button className="button secondary" disabled title="Disponível quando o Outlook for conectado">↻ Atualizar e-mails</button>
          <button className="button primary" onClick={() => setShowForm(true)}>＋ Nova RNC</button>
        </div>
      </header>

      <section className="page-heading">
        <div><p className="eyebrow">Visão geral</p><h1>Relatórios de Não Conformidade</h1><p>Acompanhe prazos, respostas e retornos da Supervisão.</p></div>
        <div className="export-actions"><button onClick={exportExcel}>↓ Excel</button><button onClick={() => window.print()}>↓ PDF</button></div>
      </section>

      <section className="metrics">
        {[
          ["Total de RNC", stats.total, "neutral"], ["Recebidas", stats.received, "amber"],
          ["Respondidas", stats.answered, "blue"], ["Aprovadas", stats.approved, "green"],
          ["Reprovadas", stats.rejected, "red"], ["Reabertas", stats.reopened, "violet"],
          ["Dentro do prazo", stats.onTime, "teal"], ["Vencidas", stats.overdue, "red"],
        ].map(([label, value, tone]) => <article key={String(label)} className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong><div className="metric-line" /></article>)}
      </section>

      <section className="workspace">
        <div className="filters">
          <label className="search"><span>⌕</span><input aria-label="Pesquisar RNC" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Pesquisar número, descrição ou texto…" /></label>
          <select aria-label="Filtrar por obra" value={selectedWork} onChange={(e) => setSelectedWork(e.target.value)}><option value="all">Todas as obras</option>{works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
          <select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Todos os status</option>{statusOptions.map((s) => <option key={s}>{s}</option>)}</select>
          <select aria-label="Filtrar por tipo" value={type} onChange={(e) => setType(e.target.value)}><option value="all">Todos os tipos</option>{typeOptions.map((t) => <option key={t}>{t}</option>)}</select>
          <select aria-label="Filtrar por ano" value={year} onChange={(e) => setYear(e.target.value)}><option value="all">Todos os anos</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
        </div>
        <div className="table-meta"><strong>{filtered.length} registros</strong><span>Atualização local: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date())}</span></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Nº RNC</th><th>Ano</th><th>Descrição</th><th>Tipo</th><th>Recebimento</th><th>Prazo de envio</th><th>Envio</th><th>Retorno</th><th>Status</th><th>Responsável</th><th /></tr></thead>
            <tbody>
              {busy && <tr><td colSpan={12} className="empty">Carregando registros…</td></tr>}
              {!busy && !filtered.length && <tr><td colSpan={12} className="empty"><strong>Nenhuma RNC encontrada</strong><span>Cadastre a primeira RNC ou ajuste os filtros.</span></td></tr>}
              {filtered.map((r, index) => <tr key={r.id} className={`row-${urgency(r)}`} onClick={() => openDetails(r)}>
                <td className="item">{String(index + 1).padStart(2, "0")}</td><td><strong className="rnc-number">RNC {r.number}</strong><small>{r.workName}</small></td><td>{r.year}</td>
                <td className="description">{r.description}</td><td><span className="type-tag">{r.type}</span></td><td>{fmt(r.receivedAt)}</td>
                <td><strong>{fmt(r.dueAt)}</strong>{!r.sentAt && <small>{businessDaysUntil(r.dueAt) < 0 ? `${Math.abs(businessDaysUntil(r.dueAt))} dias úteis em atraso` : `${businessDaysUntil(r.dueAt)} dias úteis`}</small>}</td>
                <td>{fmt(r.sentAt)}</td><td>{fmt(r.returnedAt)}</td><td><span className={`status status-${r.status.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll(" ", "-")}`}>{r.status}</span></td>
                <td>{r.responseOwner || "—"}</td><td><button className="dots" aria-label={`Abrir RNC ${r.number}`}>•••</button></td>
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
          <dl><div><dt>Tipo</dt><dd>{selected.type}</dd></div><div><dt>Recebimento</dt><dd>{fmt(selected.receivedAt)}</dd></div><div><dt>Prazo</dt><dd>{fmt(selected.dueAt)}</dd></div><div><dt>Envio</dt><dd>{fmt(selected.sentAt)}</dd></div><div><dt>Retorno</dt><dd>{fmt(selected.returnedAt)}</dd></div><div><dt>Resp. pela resposta</dt><dd>{selected.responseOwner || "Não informado"}</dd></div><div><dt>Resp. pela análise</dt><dd>{selected.analysisOwner || "Não informado"}</dd></div></dl>
          <section className="notes"><h4>Observações internas</h4><p>{selected.notes || "Nenhuma observação registrada."}</p></section>
          <section className="timeline"><h4>Histórico de alterações</h4>{history.length ? history.map((h) => <div className="timeline-item" key={h.id}><i /><div><strong>{labelByField[h.field] || h.field}</strong><p>{h.oldValue ? `${h.oldValue} → ` : ""}{h.newValue}</p><small>{fmt(h.changedAt)} · {h.userName}</small></div></div>) : <p className="muted">Nenhuma alteração manual adicional.</p>}</section>
        </div>
        <div className="drawer-footer"><button className="button primary wide" onClick={() => setEditing(selected)}>Editar RNC</button></div>
      </aside>}
      {(selected || editing || showForm) && <div className="backdrop" onClick={() => { setSelected(null); setEditing(null); setShowForm(false); }} />}
    </main>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={onClose}>×</button></div>{children}</div>;
}

function RncForm({ works, rnc, onSubmit }: { works: Work[]; rnc?: Rnc; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  const today = new Date().toISOString().slice(0, 10);
  return <form className="rnc-form" onSubmit={onSubmit}>
    <label className="span-2">Obra<select name="workId" defaultValue={rnc?.workId || ""} required><option value="" disabled>Selecione a obra</option>{works.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
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
