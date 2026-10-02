"use client";

import { ruleText } from "../../lib/planner-extract";
import { DATE_KIND_LABELS, PENDING_REASONS, formatBr, type PlannerItem } from "../../lib/planner-view";
import type { PlannerPam } from "../../lib/planner-service";

export function describeRule(item: PlannerItem, all: PlannerItem[]) {
  return ruleText(
    {
      quantity: item.quantity,
      unit: item.unit as "CORRIDOS" | "UTEIS",
      baseType: item.baseType as "PAM_SENT_DATE" | "FIXED_DATE" | "PREDECESSOR_COMPLETION" | "EXTERNAL_MILESTONE",
      fixedDate: item.fixedDate,
      milestoneLabel: item.milestoneLabel,
      predecessorOrder: item.predecessorId,
    },
    (id) => all.find((other) => other.id === id)?.title ?? null,
  );
}

export function pamSentText(pam: PlannerPam) {
  if (!pam.sentAt) return "DATA DE ENVIO PENDENTE";
  return `enviado em ${formatBr(pam.sentAt)} (${pam.sentSource === "MANUAL" ? "informado manualmente" : "e-mail de envio"})`;
}

// "PRAZOS IDENTIFICADOS" (seção 21.11): mostra como o sistema interpretou o PAM, sem alterar o documento original.
export function IdentifiedDeadlines({ rncLabel, pam, items, canAdjust, busy, onConfirm, onAdjust, onSentDate }: {
  rncLabel: string;
  pam: PlannerPam;
  items: PlannerItem[];
  canAdjust: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onAdjust?: (item: PlannerItem) => void;
  onSentDate?: () => void;
}) {
  const sorted = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
  const needsReview = sorted.some((item) => item.needsReview);
  return (
    <section className="pl-identified" aria-label={`Prazos identificados — ${rncLabel}`}>
      <header>
        <div>
          <h3>Prazos identificados — {rncLabel}</h3>
          <p>PAM V{pam.pamVersion}{pam.source === "EMAIL" ? " (FG 06 anexado ao e-mail)" : ""} · {pamSentText(pam)}{pam.status === "SUBSTITUIDO" ? " · substituído por PAM posterior" : ""}</p>
        </div>
        <span className={`pl-confirm-state${pam.confirmedAt ? " ok" : ""}`}>
          {pam.confirmedAt ? `Interpretação confirmada${pam.confirmedBy ? ` por ${pam.confirmedBy.split(" <")[0]}` : ""}` : needsReview ? "Interpretação a revisar" : "Interpretação a confirmar"}
        </span>
      </header>
      <ol>
        {sorted.map((item) => (
          <li key={item.id} className={item.needsReview ? "review" : ""}>
            <div>
              <strong>{item.orderIndex}. {item.title}</strong>
              <span>{describeRule(item, sorted)}</span>
              {item.needsReview && <em>Revisar: {item.reviewReason || "interpretação incerta."}</em>}
            </div>
            <div className="pl-identified-date">
              {item.due
                ? <><strong>{formatBr(item.due)}</strong><small>{item.isProjected ? "○ " : "● "}{DATE_KIND_LABELS[item.dateKind]}</small></>
                : <small>{PENDING_REASONS[item.state] ?? "Sem data"}</small>}
            </div>
            {canAdjust && onAdjust && <button type="button" className="button secondary" onClick={() => onAdjust(item)} disabled={busy}>Ajustar</button>}
          </li>
        ))}
      </ol>
      {canAdjust && (
        <footer>
          {!pam.confirmedAt && onConfirm && <button type="button" className="button primary" onClick={onConfirm} disabled={busy}>Confirmar interpretação</button>}
          {!pam.sentAt && onSentDate && <button type="button" className="button secondary" onClick={onSentDate} disabled={busy}>Informar data de envio</button>}
        </footer>
      )}
      <p className="pl-identified-note">A confirmação ou o ajuste alimenta apenas o Planner; o texto, o Word e o PDF do PAM não são alterados.</p>
    </section>
  );
}
