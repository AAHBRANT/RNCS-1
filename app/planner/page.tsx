"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RefreshCw, Settings2 } from "lucide-react";
import { Sidebar } from "../components/sidebar";
import { Topbar } from "../components/topbar";
import { useSidebarCollapse } from "../../lib/use-sidebar-collapse";
import { URGENCY_LABELS, DEFAULT_URGENCY_BANDS, addDays, type Urgency } from "../../lib/planner-calc";
import {
  PENDING_REASONS,
  buildItems,
  groupByDay,
  matchesKind,
  matchesStatus,
  monthTitle,
  rncLabel,
  shiftMonth,
  weekTitle,
  type KindFilter,
  type PlannerApiData,
  type StatusFilter,
} from "../../lib/planner-view";
import { PlannerCalendar } from "./calendar";
import { CommitmentDialog } from "./commitment-dialog";
import { IdentifiedDeadlines } from "./identified-deadlines";

type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };
type WorkOption = { id: number; name: string; accessible: boolean };

const REFRESH_MS = 60_000;
const LEGEND: Urgency[] = ["VERDE", "AMARELO", "LARANJA", "VERMELHO", "ATRASADO", "CONCLUIDO"];

export default function PlannerPage() {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [data, setData] = useState<PlannerApiData | null>(null);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [outlook, setOutlook] = useState({ configured: false, connected: false });
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const [view, setView] = useState<"month" | "week">("month");
  const [cursor, setCursor] = useState<string | null>(null);
  const [rncFilter, setRncFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [bandsOpen, setBandsOpen] = useState(false);
  const [bandsDraft, setBandsDraft] = useState(DEFAULT_URGENCY_BANDS);
  const lastLoad = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [response, worksResponse] = await Promise.all([
        fetch("/api/planner", { cache: "no-store" }),
        silent ? Promise.resolve(null) : fetch("/api/works").then((item) => item.json()).catch(() => null),
      ]);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar o Planner.");
      setData(payload as PlannerApiData);
      setAccessUser(payload.user || null);
      setBandsDraft(payload.bands);
      if (worksResponse?.works) setWorks(worksResponse.works);
      if (worksResponse && "activeWorkId" in worksResponse) setActiveWorkId(worksResponse.activeWorkId ?? null);
      setUpdatedAt(new Date());
      lastLoad.current = Date.now();
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : "Não foi possível carregar o Planner.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      const requested = new URLSearchParams(window.location.search).get("rnc");
      if (requested) setRncFilter(requested);
      void load(true);
    });
    fetch("/api/outlook/status").then((response) => response.json()).then((value) => { if (!value.error) setOutlook(value); }).catch(() => undefined);
    fetch("/api/works").then((response) => response.json()).then((value) => {
      if (value.works) setWorks(value.works);
      if ("activeWorkId" in value) setActiveWorkId(value.activeWorkId ?? null);
    }).catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastLoad.current > 10_000) void load(true); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  async function selectWork(id: number) {
    const response = await fetch(`/api/works/${id}/select`, { method: "POST" });
    if (!response.ok) { setNotice("Não foi possível trocar de obra."); return; }
    setActiveWorkId(id);
    setRncFilter("all");
    await load();
  }

  async function send(url: string, body: Record<string, unknown>, method = "PATCH") {
    setBusy(true);
    try {
      const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      await load(true);
      return true;
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : "Não foi possível salvar.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function runBackfill() {
    setBusy(true);
    try {
      const response = await fetch("/api/planner/backfill", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível analisar os PAMs.");
      setNotice(`${payload.rncs} RNC(s) com PAM analisadas; ${payload.created} PAM(s) novos incorporados ao Planner.`);
      await load(true);
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : "Não foi possível analisar os PAMs.");
    } finally {
      setBusy(false);
    }
  }

  async function saveBands() {
    const ok = await send("/api/planner/settings", { bands: bandsDraft }, "PUT");
    if (ok) setNotice("Faixas de cor atualizadas.");
  }

  const today = data?.today ?? "";
  const anchor = cursor ?? today;
  const items = useMemo(() => data ? buildItems({ commitments: data.commitments, pams: data.pams, rncs: data.rncs, bands: data.bands, today: data.today }) : [], [data]);
  const filtered = useMemo(() => items.filter((item) =>
    (showSuperseded || !item.superseded)
    && (rncFilter === "all" || String(item.rncId) === rncFilter)
    && matchesStatus(item, statusFilter)
    && matchesKind(item, kindFilter)), [items, rncFilter, statusFilter, kindFilter, showSuperseded]);
  const byDay = useMemo(() => groupByDay(filtered), [filtered]);
  const undated = filtered.filter((item) => !item.due && !item.superseded && !item.completed);
  const selected = selectedId ? items.find((item) => item.id === selectedId) ?? null : null;
  const canAdjust = Boolean(data?.canAdjust);
  const isAdmin = !accessUser || accessUser.role === "admin";
  const pamsForRnc = rncFilter === "all" || !data ? [] : data.pams.filter((pam) => String(pam.rncId) === rncFilter && (showSuperseded || pam.status !== "SUBSTITUIDO"));

  function move(delta: number) {
    setCursor(view === "month" ? shiftMonth(anchor, delta) : addDays(anchor, delta * 7));
  }

  const title = !data ? "" : view === "month" ? monthTitle(anchor) : weekTitle(anchor);

  return (
    <div className="app-shell">
      <Topbar activeUser={accessUser} collapsed={collapsed} onToggleCollapse={toggleCollapsed} works={works} activeWorkId={activeWorkId} onSelectWork={selectWork} />
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
        <section className="page-heading rp-heading">
          <div>
            <p className="eyebrow">Acompanhamento</p>
            <h1>Calendário / Planner</h1>
            <p>Prazos e etapas assumidos nos PAMs, calculados a partir do envio real de cada documento.</p>
          </div>
          <div className="rp-actions">
            {canAdjust && <button type="button" className="button secondary" onClick={runBackfill} disabled={busy || loading}>Analisar PAMs existentes</button>}
            {isAdmin && <button type="button" className="button secondary" onClick={() => setBandsOpen((value) => !value)} aria-expanded={bandsOpen}><Settings2 size={14} /> Faixas de cor</button>}
            <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={14} /> {loading ? "Atualizando…" : "Atualizar"}</button>
          </div>
        </section>

        <section className="rp-page pl-page">
          {bandsOpen && isAdmin && (
            <div className="rp-panel pl-bands">
              <h2>Faixas de cor por proximidade do prazo</h2>
              <p>Dias restantes até o prazo. Abaixo da faixa laranja o compromisso fica vermelho; vencido e não concluído fica &quot;atrasado&quot;.</p>
              <div className="pl-form-row">
                <label>Verde a partir de<input type="number" min={1} value={bandsDraft.greenMin} onChange={(event) => setBandsDraft({ ...bandsDraft, greenMin: Number(event.target.value) })} /></label>
                <label>Amarelo a partir de<input type="number" min={1} value={bandsDraft.yellowMin} onChange={(event) => setBandsDraft({ ...bandsDraft, yellowMin: Number(event.target.value) })} /></label>
                <label>Laranja a partir de<input type="number" min={1} value={bandsDraft.orangeMin} onChange={(event) => setBandsDraft({ ...bandsDraft, orangeMin: Number(event.target.value) })} /></label>
                <button type="button" className="button primary" onClick={saveBands} disabled={busy}>Salvar faixas</button>
              </div>
            </div>
          )}

          <div className="rp-panel pl-toolbar">
            <div className="pl-toolbar-row">
              <div className="response-type-switch" role="group" aria-label="Visualização">
                <button type="button" className={view === "month" ? "active" : ""} aria-pressed={view === "month"} onClick={() => setView("month")}>Mês</button>
                <button type="button" className={view === "week" ? "active" : ""} aria-pressed={view === "week"} onClick={() => setView("week")}>Semana</button>
              </div>
              <div className="pl-nav">
                <button type="button" className="button secondary" onClick={() => move(-1)} aria-label="Anterior"><ChevronLeft size={14} /></button>
                <button type="button" className="button secondary" onClick={() => setCursor(null)}>Hoje</button>
                <button type="button" className="button secondary" onClick={() => move(1)} aria-label="Próximo"><ChevronRight size={14} /></button>
                <strong>{title}</strong>
              </div>
            </div>
            <div className="pl-toolbar-row pl-filters">
              <label>RNC
                <select value={rncFilter} onChange={(event) => { setRncFilter(event.target.value); setSelectedId(null); }}>
                  <option value="all">Todas as RNCs</option>
                  {data?.rncs.map((rnc) => <option key={rnc.id} value={rnc.id}>{rncLabel(rnc)}</option>)}
                </select>
              </label>
              <label>Situação
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}>
                  <option value="all">Todos</option><option value="pending">Pendente</option><option value="near">Próximo do prazo</option>
                  <option value="late">Atrasado</option><option value="done">Concluído</option>
                </select>
              </label>
              <label>Tipo
                <select value={kindFilter} onChange={(event) => setKindFilter(event.target.value as KindFilter)}>
                  <option value="all">Todos</option><option value="FINAL">Prazo final do PAM</option><option value="ETAPA">Etapa / ação intermediária</option>
                </select>
              </label>
              <label className="pl-check"><input type="checkbox" checked={showSuperseded} onChange={(event) => setShowSuperseded(event.target.checked)} /> Mostrar prazos substituídos</label>
            </div>
          </div>

          {pamsForRnc.map((pam) => (
            <IdentifiedDeadlines
              key={pam.id}
              rncLabel={rncLabel(data?.rncs.find((rnc) => rnc.id === pam.rncId))}
              pam={pam}
              items={items.filter((item) => item.plannerPamId === pam.id)}
              canAdjust={canAdjust && pam.status !== "SUBSTITUIDO"}
              busy={busy}
              onConfirm={() => void send(`/api/planner/pams/${pam.id}`, { action: "confirm" })}
              onAdjust={(item) => setSelectedId(item.id)}
              onSentDate={() => { const first = items.find((item) => item.plannerPamId === pam.id); if (first) setSelectedId(first.id); }}
            />
          ))}

          <div className="rp-panel">
            {!data ? (
              <p className="rp-empty">{loading ? "Carregando o Planner…" : "Não foi possível carregar o Planner."}</p>
            ) : !items.length ? (
              <p className="rp-empty">Nenhum compromisso no Planner ainda. Os prazos aparecem automaticamente quando um PAM é salvo{canAdjust ? "; use “Analisar PAMs existentes” para incorporar os já enviados" : ""}.</p>
            ) : (
              <>
                <PlannerCalendar view={view} cursor={anchor} today={today} byDay={byDay} onSelect={(item) => setSelectedId(item.id)} />
                <div className="pl-legend" aria-label="Legenda">
                  <span><b aria-hidden="true">●</b> Data vigente / calculada</span>
                  <span><b aria-hidden="true">○</b> Data projetada</span>
                  <span><b aria-hidden="true">✓</b> Concluído</span>
                  {LEGEND.map((urgency) => <span key={urgency}><i className={`pl-swatch pl-${urgency}`} />{URGENCY_LABELS[urgency]}</span>)}
                </div>
                <small className="pl-updated">{updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString("pt-BR")} · atualiza sozinho a cada minuto` : "Carregando…"}</small>
              </>
            )}
          </div>

          {undated.length > 0 && (
            <div className="rp-panel">
              <h2 className="pl-undated-title">Sem data definida ({undated.length})</h2>
              <p className="pl-note">Estes compromissos ainda não têm data no calendário.</p>
              <ul className="pl-undated">
                {undated.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => setSelectedId(item.id)}>
                      <strong>{rncLabel(item.rnc)} · {item.title}</strong>
                      <span>{PENDING_REASONS[item.state] ?? "Sem data"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>

      {selected && (
        <CommitmentDialog
          key={selected.id}
          item={selected}
          siblings={items.filter((item) => item.plannerPamId === selected.plannerPamId)}
          today={today}
          canAdjust={canAdjust}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onCommitment={(id, body) => send(`/api/planner/commitments/${id}`, body)}
          onPam={(pamId, body) => send(`/api/planner/pams/${pamId}`, body)}
        />
      )}
      {notice && <button type="button" className="toast" onClick={() => setNotice("")}>{notice}</button>}
    </div>
  );
}
