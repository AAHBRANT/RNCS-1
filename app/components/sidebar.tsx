"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

export type SidebarProps = {
  activeUser: { name: string; email: string; role: "admin" | "drafter" | "reviewer_approver" } | null;
  activeWorkName: string | null;
  canCreateRnc: boolean;
  outlook: { connected: boolean; configured: boolean };
  syncing: boolean;
  onSync: () => void;
  onNewRnc: () => void;
};

export function Sidebar({ activeUser, activeWorkName, canCreateRnc, outlook, syncing, onSync, onNewRnc }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => pathname === href || pathname?.startsWith(href + "/");

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <Image src="/favicon-rnc.png" alt="RNC" width={48} height={48} className="sidebar-brand" />
      </div>

      {activeWorkName && (
        <div className="sidebar-work">
          <p>Obra ativa</p>
          <a href="/selecionar-obra">{activeWorkName}</a>
        </div>
      )}

      <nav className="sidebar-nav">
        <a href="/" className={isActive("/") && !isActive("/responder") ? "active" : ""}>
          Lista de RNCs
        </a>
        <a href="/responder" className={isActive("/responder") ? "active" : ""}>
          Elaborar respostas
        </a>
        <p>Central de Respostas</p>
        <p>Notificações</p>
      </nav>

      <div className="sidebar-actions">
        {canCreateRnc && <button className="button primary wide" onClick={onNewRnc}>＋ Nova RNC</button>}
      </div>

      <div className="sidebar-sync">
        <span className="sidebar-sync-status"><i className={outlook.connected ? "on" : ""} /> {outlook.connected ? "Outlook conectado" : "Operação manual"}</span>
        <button
          className="button secondary wide"
          onClick={onSync}
          disabled={syncing || (!outlook.configured && !outlook.connected)}
          title={!outlook.configured ? "Configure as credenciais Microsoft na Vercel" : undefined}
        >
          {syncing ? "Atualizando…" : outlook.connected ? "↻ Atualizar e-mails" : "Conectar Outlook"}
        </button>
      </div>

      <div className="sidebar-footer">
        {activeUser && (
          <>
            <div className="sidebar-user">
              {activeUser.name}
              <small>{activeUser.email}</small>
            </div>
            <a href="/api/auth/logout" className="sidebar-logout">
              Sair
            </a>
          </>
        )}
      </div>
    </aside>
  );
}
