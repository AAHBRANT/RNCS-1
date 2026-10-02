"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { Sidebar } from "../components/sidebar";
import { Topbar } from "../components/topbar";
import { useSidebarCollapse } from "../../lib/use-sidebar-collapse";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  buildMonthlyReport,
  type ReportRnc,
} from "../../lib/rnc-report";
import { REPORT_COLORS, ReportChart, type Selection } from "./report-chart";

type AccessUser = { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" };
type WorkOption = { id: number; name: string; accessible: boolean };

const ALL = "all";
const REFRESH_MS = 60_000;

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("pt-BR").format(date);
}

export default function RelatorioPage() {
  const [collapsed, toggleCollapsed] = useSidebarCollapse();
  const [rncs, setRncs] = useState<ReportRnc[]>([]);
  const [accessUser, setAccessUser] = useState<AccessUser | null>(null);
  const [outlook, setOutlook] = useState({ configured: false, connected: false });
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [activeWorkId, setActiveWorkId] = useState<number | null>(null);
  const [type, setType] = useState(ALL);
  const [selected, setSelected] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const lastLoad = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/rncs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os dados.");
      setRncs((data.rncs || []) as ReportRnc[]);
      setAccessUser(data.user || null);
      if (data.works) setWorks(data.works);
      if ("activeWorkId" in data) setActiveWorkId(data.activeWorkId ?? null);
      setUpdatedAt(new Date());
      setError("");
      lastLoad.current = Date.now();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível carregar os dados.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => { void load(true); });
    fetch("/api/outlook/status")
      .then((response) => response.json())
      .then((data) => { if (!data.error) setOutlook(data); })
      .catch(() => undefined);
  }, [load]);

  // Atualização em tempo (quase) real: a cada minuto e ao voltar para a aba.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastLoad.current > 10_000) void load(true);
    };
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
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      setError(data.error || "Não foi possível trocar de obra.");
      return;
    }
    setActiveWorkId(id);
    setSelected(null);
    await load();
  }

  const typeOptions = useMemo(() => [...new Set(rncs.map((rnc) => rnc.type).filter(Boolean))].sort() as string[], [rncs]);
  const filtered = useMemo(() => rncs.filter((rnc) => type === ALL || rnc.type === type), [rncs, type]);
  const report = useMemo(() => buildMonthlyReport(filtered), [filtered]);

  const selectedMonth = selected ? report.months.find((month) => month.key === selected.monthKey) : null;
  const selectedItems = selected && selectedMonth ? selectedMonth.items[selected.category] : [];
  const period = report.months.length ? `${report.months[0].label} a ${report.months.at(-1)!.label}` : "";

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
            <p className="eyebrow">Indicadores</p>
            <h1>Relatório</h1>
            <p>RNCs recebidas por mês, separadas por situação. Passe o mouse sobre uma cor para ver as RNCs.</p>
          </div>
          <div className="rp-actions">
            <label>Tipo da RNC
              <select value={type} onChange={(event) => { setType(event.target.value); setSelected(null); }}>
                <option value={ALL}>Todos os tipos</option>
                {typeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <button type="button" className="button secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw size={14} /> {loading ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </section>

        <section className="rp-page">
          {error && <div className="rp-error" role="alert">{error}</div>}

          <div className="rp-cards">
            <div className="rp-card"><span>Total de RNCs</span><strong>{report.total}</strong></div>
            {REPORT_CATEGORIES.map((category) => (
              <div className="rp-card" key={category}>
                <span><i style={{ background: REPORT_COLORS[category] }} />{REPORT_CATEGORY_LABELS[category]}</span>
                <strong>{report.totals[category]}</strong>
              </div>
            ))}
          </div>

          <div className="rp-panel">
            <header className="rp-panel-head">
              <div>
                <h2>RNCs recebidas por mês</h2>
                <p>{period ? `${period} · período = mês de recebimento · situação atual no sistema` : "Sem RNCs com data de recebimento."}</p>
              </div>
              <small>{updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString("pt-BR")} · atualiza sozinho a cada minuto` : "Carregando…"}</small>
            </header>

            {report.months.length ? (
              <ReportChart months={report.months} selected={selected} onSelect={setSelected} />
            ) : (
              <p className="rp-empty">{loading ? "Carregando dados…" : "Nenhuma RNC para exibir com o filtro atual."}</p>
            )}

            <div className="rp-legend" aria-label="Legenda">
              {REPORT_CATEGORIES.map((category) => (
                <span key={category}><i style={{ background: REPORT_COLORS[category] }} />{REPORT_CATEGORY_LABELS[category]}</span>
              ))}
            </div>
            {report.undated.length > 0 && (
              <p className="rp-note">{report.undated.length} {report.undated.length === 1 ? "RNC sem data de recebimento não aparece" : "RNCs sem data de recebimento não aparecem"} no gráfico, mas {report.undated.length === 1 ? "entra" : "entram"} nos totais.</p>
            )}
          </div>

          {selected && selectedMonth && (
            <div className="rp-panel">
              <header className="rp-panel-head">
                <div>
                  <h2><i className="rp-dot" style={{ background: REPORT_COLORS[selected.category] }} />{REPORT_CATEGORY_LABELS[selected.category]} · {selectedMonth.longLabel}</h2>
                  <p>{selectedItems.length} {selectedItems.length === 1 ? "RNC" : "RNCs"}</p>
                </div>
                <button type="button" className="button secondary" onClick={() => setSelected(null)}><X size={14} /> Fechar lista</button>
              </header>
              <div className="rp-table-wrap">
                <table className="rp-table">
                  <thead><tr><th>RNC</th><th>Descrição</th><th>Tipo</th><th>Situação</th><th>Recebida em</th></tr></thead>
                  <tbody>
                    {selectedItems.map((item) => (
                      <tr key={item.id}>
                        <td><strong>{item.number}/{item.year}</strong></td>
                        <td>{item.description}</td>
                        <td>{item.type || "—"}</td>
                        <td>{item.status}</td>
                        <td>{formatDate(item.receivedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
