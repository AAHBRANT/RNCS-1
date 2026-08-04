"use client";

import Image from "next/image";

export type TopbarProps = {
  activeUser: { name: string; email: string } | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
};

export function Topbar({ activeUser, collapsed, onToggleCollapse }: TopbarProps) {
  return (
    <header className="app-topbar">
      <div className="app-topbar-left">
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          ☰
        </button>
        <Image src="/favicon-rnc.png" alt="RNC" width={32} height={32} className="brand-mark" />
      </div>

      {activeUser && (
        <div className="app-topbar-user">
          <span className="user-chip">
            <strong>{activeUser.name}</strong>
            <small>{activeUser.email}</small>
          </span>
          <a href="/api/auth/logout" className="logout-link">Sair</a>
        </div>
      )}
    </header>
  );
}
