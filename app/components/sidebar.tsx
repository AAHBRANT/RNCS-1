"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export type SidebarProps = {
  activeUser: { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" } | null;
  activeWorkName: string | null;
  canCreateRnc: boolean;
  outlook: { connected: boolean; configured: boolean };
  syncing: boolean;
  onSync: () => void;
  onNewRnc: () => void;
  onExportExcel: () => void;
  onExportPdf: () => void;
};

const COLLAPSE_STORAGE_KEY = "sidebar-collapsed";

export function Sidebar({
  activeUser, activeWorkName, canCreateRnc, outlook, syncing, onSync, onNewRnc, onExportExcel, onExportPdf,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  useEffect(() => {
    setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    return () => document.body.classList.remove("sidebar-collapsed");
  }, [collapsed]);

  function toggleCollapsed() {
    setCollapsed((current) => {
      const next = !current;
      localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      return next;
    });
  }

  return (
    <aside className={`sidebar${collapsed ? " collapsed" : ""}`}>
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={toggleCollapsed} aria-expanded={!collapsed} title={collapsed ? "Expandir menu" : "Recolher menu"}>☰</button>
        {!collapsed && <span className="sidebar-title">Controle de RNC</span>}
        <Image src="/favicon-rnc.png" alt="RNC" width={36} height={36} className="sidebar-brand" />
      </div>

      {activeWorkName && (
        <div className="sidebar-work" title={collapsed ? activeWorkName : undefined}>
          {!collapsed && <p>Obra ativa</p>}
          <a href="/selecionar-obra">{collapsed ? "🏗" : activeWorkName}</a>
        </div>
      )}

      <nav className="sidebar-nav">
        <div className="sidebar-group">
          {!collapsed && <p className="sidebar-group-label">RNC&apos;s</p>}
          {canCreateRnc && (
            <button className="sidebar-new-rnc" onClick={onNewRnc} title="Nova RNC">
              <span className="icon">＋</span>{!collapsed && <span className="label">Nova RNC</span>}
            </button>
          )}
          <a href="/" className={isActive("/") && !isActive("/responder") ? "active" : ""} title="Lista de RNCs">
            <span className="icon">📋</span>{!collapsed && <span className="label">Lista de RNCs</span>}
          </a>
        </div>
        <a href="/responder" className={isActive("/responder") ? "active" : ""} title="Responder">
          <span className="icon">✎</span>{!collapsed && <span className="label">Responder</span>}
        </a>
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
        {activeUser && (
          <>
            <div className="sidebar-user" title={collapsed ? activeUser.name : undefined}>
              {collapsed ? activeUser.name.charAt(0) : activeUser.name}
              {!collapsed && <small>{activeUser.email}</small>}
            </div>
            <a href="/api/auth/logout" className="sidebar-logout" title="Sair">
              {collapsed ? "⎋" : "Sair"}
            </a>
          </>
        )}
      </div>
    </aside>
  );
}
