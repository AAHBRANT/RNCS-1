"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type TopbarWork = { id: number; name: string; accessible: boolean };

export type TopbarProps = {
  activeUser: { name: string; email: string } | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  works: TopbarWork[];
  activeWorkId: number | null;
  onSelectWork: (id: number) => void;
};

export function Topbar({ activeUser, collapsed, onToggleCollapse, works, activeWorkId, onSelectWork }: TopbarProps) {
  const [workMenuOpen, setWorkMenuOpen] = useState(false);
  const workMenuRef = useRef<HTMLDivElement>(null);
  const activeWork = works.find((w) => w.id === activeWorkId);
  const accessibleWorks = works.filter((w) => w.accessible);

  useEffect(() => {
    if (!workMenuOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (workMenuRef.current && !workMenuRef.current.contains(event.target as Node)) {
        setWorkMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [workMenuOpen]);

  return (
    <header className="app-topbar">
      <div className="app-topbar-left">
        <Image src="/favicon-rnc.png" alt="RNC" width={32} height={32} className="brand-mark" />
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          ☰
        </button>
        <span className="app-topbar-title">Controle de RNC</span>
        {activeWork && accessibleWorks.length > 0 && (
          <div className="app-topbar-work" ref={workMenuRef}>
            <span className="app-topbar-separator">|</span>
            <button
              className="app-topbar-work-toggle"
              onClick={() => setWorkMenuOpen((v) => !v)}
              aria-expanded={workMenuOpen}
              title={activeWork.name}
            >
              Obra: <strong>{activeWork.name}</strong> ▼
            </button>
            {workMenuOpen && (
              <div className="app-topbar-work-menu">
                {accessibleWorks.map((work) => (
                  <button
                    key={work.id}
                    className={work.id === activeWorkId ? "active" : ""}
                    onClick={() => {
                      setWorkMenuOpen(false);
                      if (work.id !== activeWorkId) onSelectWork(work.id);
                    }}
                  >
                    {work.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
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
