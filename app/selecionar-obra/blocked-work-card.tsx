"use client";

import { useState } from "react";

export function BlockedWorkCard({ name }: { name: string }) {
  const [showWarning, setShowWarning] = useState(false);

  return (
    <>
      <div
        className="work-card blocked"
        onClick={() => setShowWarning(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setShowWarning(true);
          }
        }}
      >
        <h3>{name}</h3>
        <p className="status">Sem acesso</p>
        <p className="hint">Clique para mais informações</p>
      </div>

      {showWarning && (
        <div className="warning-overlay" onClick={() => setShowWarning(false)}>
          <div className="warning-dialog" onClick={(e) => e.stopPropagation()}>
            <h2>Acesso negado</h2>
            <p>Você não tem permissão para acessar esta obra.</p>
            <p className="muted">Solicite acesso ao administrador.</p>
            <button onClick={() => setShowWarning(false)} className="button primary">
              Entendido
            </button>
          </div>
        </div>
      )}
    </>
  );
}
