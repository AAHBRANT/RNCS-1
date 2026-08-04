"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

export type SidebarProps = {
  activeWorkName: string | null;
  canCreateRnc: boolean;
  outlook: { connected: boolean; configured: boolean };
  syncing: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSync: () => void;
  onNewRnc: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
};

export function Sidebar({
  activeWorkName, canCreateRnc, outlook, syncing, collapsed, onToggleCollapse, onSync, onNewRnc, onExportExcel, onExportPdf,
}: SidebarProps) {
  const pathname = usePathname();
  const [exportOpen, setExportOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      {activeWorkName && (
        <div className="sidebar-work" title={collapsed ? activeWorkName : undefined}>
          {!collapsed && <p>Obra ativa</p>}
          <a href="/selecionar-obra">{collapsed ? "🏗" : activeWorkName}</a>
        </div>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-group">
          {!collapsed && <p className="sidebar-group-label">RNC&apos;s</p>}
          <a href="/" className={isActive("/") && !isActive("/responder") ? "active" : ""} title="Lista de RNCs">
            <span className="icon">📋</span>{!collapsed && <span className="label">Lista</span>}
          </a>
          {canCreateRnc && (
            <button className="sidebar-new-rnc" onClick={onNewRnc} title="Nova RNC">
              <span className="icon">＋</span>{!collapsed && <span className="label">Nova RNC</span>}
            </button>
          )}
          <a href="/responder" className={isActive("/responder") ? "active" : ""} title="Responder">
            <span className="icon">✎</span>{!collapsed && <span className="label">Responder</span>}
          </a>
        </div>
        <p title="Notificações">
          <span className="icon">🔔</span>{!collapsed && <span className="label">Notificações</span>}
        </p>
        <div className="sidebar-group">
          <button
            className={`sidebar-nav-toggle${exportOpen ? " open" : ""}`}
            onClick={() => setExportOpen((v) => !v)}
            title="Exportar"
            aria-expanded={exportOpen}
          >
            <span className="icon">⬇</span>{!collapsed && <span className="label">Exportar</span>}
          </button>
          {exportOpen && !collapsed && (
            <div className="sidebar-submenu">
              <button onClick={onExportExcel}>Exportar Excel</button>
              <button onClick={onExportPdf}>Exportar PDF</button>
            </div>
          )}
        </div>
      </nav>

      <div className="sidebar-sync">
        <span className="sidebar-sync-status" title={collapsed ? (outlook.connected ? "Outlook conectado" : "Operação manual") : undefined}>
          <i className={outlook.connected ? "on" : ""} />
          {!collapsed && (outlook.connected ? "Outlook conectado" : "Operação manual")}
        </span>
        <button
          className="button secondary wide"
          onClick={onSync}
          disabled={syncing || (!outlook.configured && !outlook.connected)}
          title={!outlook.configured ? "Configure as credenciais Microsoft na Vercel" : (syncing ? "Atualizando…" : outlook.connected ? "Atualizar e-mails" : "Conectar Outlook")}
        >
          {collapsed ? "↻" : (syncing ? "Atualizando…" : outlook.connected ? "↻ Atualizar e-mails" : "Conectar Outlook")}
        </button>
      </div>

      <div className="sidebar-footer">
        <button
          className="sidebar-collapse-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          <span className="icon">⧉</span>{!collapsed && <span className="label">Recolher menu</span>}
        </button>
      </div>
    </aside>
  );
}
