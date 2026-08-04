"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell, ClipboardList, Download, PanelLeftClose, PanelLeftOpen, Plus, RefreshCw, Reply, Tag,
} from "lucide-react";

export type SidebarProps = {
  canCreateRnc: boolean;
  outlook: { connected: boolean; configured: boolean };
  syncing: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSync: () => void;
  onNewRnc: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
  canReclassifyTypes?: boolean;
  reclassifying?: boolean;
  onReclassifyTypes?: () => void;
};

export function Sidebar({
  canCreateRnc, outlook, syncing, collapsed, onToggleCollapse, onSync, onNewRnc, onExportExcel, onExportPdf,
  canReclassifyTypes = false, reclassifying = false, onReclassifyTypes,
}: SidebarProps) {
  const pathname = usePathname();
  const [exportOpen, setExportOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>

      <nav className="sidebar-nav">
        <div className="sidebar-group">
          {!collapsed && <p className="sidebar-group-label">RNC&apos;s</p>}
          <a href="/" className={isActive("/") && !isActive("/responder") ? "active" : ""} title="Lista de RNCs">
            <span className="icon"><ClipboardList size={14} /></span>{!collapsed && <span className="label">Lista</span>}
          </a>
          {canCreateRnc && (
            <button className="sidebar-new-rnc" onClick={onNewRnc} title="Nova RNC">
              <span className="icon"><Plus size={14} /></span>{!collapsed && <span className="label">Nova RNC</span>}
            </button>
          )}
          <a href="/responder" className={isActive("/responder") ? "active" : ""} title="Responder">
            <span className="icon"><Reply size={14} /></span>{!collapsed && <span className="label">Responder</span>}
          </a>
        </div>
        <p title="Notificações">
          <span className="icon"><Bell size={14} /></span>{!collapsed && <span className="label">Notificações</span>}
        </p>
        <div className="sidebar-group">
          <button
            className={`sidebar-nav-toggle${exportOpen ? " open" : ""}`}
            onClick={() => setExportOpen((v) => !v)}
            title="Exportar"
            aria-expanded={exportOpen}
          >
            <span className="icon"><Download size={14} /></span>{!collapsed && <span className="label">Exportar</span>}
          </button>
          {exportOpen && !collapsed && (
            <div className="sidebar-submenu">
              <button onClick={onExportExcel}>Exportar Excel</button>
              <button onClick={onExportPdf}>Exportar PDF</button>
            </div>
          )}
        </div>
      </nav>

      {canReclassifyTypes && (
        <div className="sidebar-actions">
          <button
            className="sidebar-reclassify"
            onClick={onReclassifyTypes}
            disabled={reclassifying}
            title={reclassifying ? "Reclassificando…" : "Reclassificar tipos"}
          >
            <span className="icon"><Tag size={14} /></span>{!collapsed && <span className="label">{reclassifying ? "Reclassificando…" : "Reclassificar tipos"}</span>}
          </button>
        </div>
      )}

      <div className="sidebar-sync">
        {collapsed ? (
          <i
            className={`sidebar-sync-dot${outlook.connected ? " on" : ""}`}
            title={outlook.connected ? "Outlook conectado" : "Operação manual"}
          />
        ) : (
          <>
            <span className="sidebar-sync-status">
              <i className={outlook.connected ? "on" : ""} />
              {outlook.connected ? "Outlook conectado" : "Operação manual"}
            </span>
            <button
              className="button secondary wide"
              onClick={onSync}
              disabled={syncing || (!outlook.configured && !outlook.connected)}
              title={!outlook.configured ? "Configure as credenciais Microsoft na Vercel" : (syncing ? "Atualizando…" : outlook.connected ? "Atualizar e-mails" : "Conectar Outlook")}
            >
              {syncing ? "Atualizando…" : outlook.connected
                ? <><RefreshCw size={12} /> Atualizar e-mails</>
                : "Conectar Outlook"}
            </button>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        <button
          className="sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          <span className="icon">{collapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}</span>{!collapsed && <span className="label">Recolher menu</span>}
        </button>
      </div>
    </aside>
  );
}
