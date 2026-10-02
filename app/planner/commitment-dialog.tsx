"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { URGENCY_LABELS } from "../../lib/planner-calc";
import { DATE_KIND_LABELS, PENDING_REASONS, formatBr, rncLabel, type PlannerItem } from "../../lib/planner-view";
import { describeRule, pamSentText } from "./identified-deadlines";

type Body = Record<string, unknown>;

function baseDescription(item: PlannerItem, siblings: PlannerItem[]) {
  const predecessor = siblings.find((other) => other.id === item.predecessorId);
  if (item.baseType === "FIXED_DATE") return "Data expressa no próprio PAM";
  if (item.baseType === "PAM_SENT_DATE") return item.pam?.sentAt ? `${formatBr(item.pam.sentAt)} — envio do PAM` : "Envio do PAM (data pendente)";
  if (item.baseType === "EXTERNAL_MILESTONE") return item.milestoneDate ? `${formatBr(item.milestoneDate)} — ${item.milestoneLabel || "marco informado"}` : `${item.milestoneLabel || "Marco informado no PAM"} (aguardando registro)`;
  if (!predecessor) return "Conclusão de outra atividade";
  return predecessor.completed
    ? `${formatBr(predecessor.completedAt)} — conclusão real de "${predecessor.title}"`
    : `${formatBr(predecessor.due)} — data prevista de "${predecessor.title}" (ainda não concluída)`;
}

export function CommitmentDialog({ item, siblings, today, canAdjust, busy, onClose, onCommitment, onPam }: {
  item: PlannerItem;
  siblings: PlannerItem[];
  today: string;
  canAdjust: boolean;
  busy: boolean;
  onClose: () => void;
  onCommitment: (id: number, body: Body) => Promise<boolean>;
  onPam: (pamId: number, body: Body) => Promise<boolean>;
}) {
  const [completeDate, setCompleteDate] = useState(today);
  const [adjustDate, setAdjustDate] = useState(item.due ?? "");
  const [adjustReason, setAdjustReason] = useState("");
  const [milestoneDate, setMilestoneDate] = useState(item.milestoneDate ?? "");
  const [sentDate, setSentDate] = useState("");
  const [sentReason, setSentReason] = useState("");
  const [rule, setRule] = useState({
    quantity: item.quantity === null ? "" : String(item.quantity),
    unit: item.unit,
    baseType: item.baseType,
    fixedDate: item.fixedDate ?? "",
    predecessorId: item.predecessorId ? String(item.predecessorId) : "",
    reason: "",
  });
  const predecessor = siblings.find((other) => other.id === item.predecessorId);
  const others = siblings.filter((other) => other.id !== item.id);
  const rncName = rncLabel(item.rnc);

  async function saveRule() {
    const body: Body = { action: "rule", reason: rule.reason, quantity: rule.quantity === "" ? null : Number(rule.quantity), unit: rule.unit, baseType: rule.baseType };
    if (rule.baseType === "FIXED_DATE") body.fixedDate = rule.fixedDate;
    if (rule.baseType === "PREDECESSOR_COMPLETION") body.predecessorId = rule.predecessorId ? Number(rule.predecessorId) : null;
    await onCommitment(item.id, body);
  }

  const statusLabel = item.superseded ? "Substituído" : item.completed ? "Concluído" : item.urgency === "ATRASADO" ? "Atrasado" : "Pendente";
  const readOnly = !canAdjust || item.superseded;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog pl-dialog" role="dialog" aria-modal="true" aria-label={`${rncName} — ${item.title}`} onClick={(event) => event.stopPropagation()}>
        <header className="pl-dialog-head">
          <div>
            <p>{rncName} · PAM V{item.pamVersion}</p>
            <h2>{item.title}</h2>
          </div>
          <button type="button" className="button secondary" onClick={onClose} aria-label="Fechar"><X size={14} /></button>
        </header>

        <blockquote className="pl-quote"><small>Texto original do PAM</small>“{item.originalText}”</blockquote>

        <dl className="pl-facts">
          <div><dt>RNC</dt><dd>{rncName}{item.rnc ? ` · ${item.rnc.workName}` : ""}</dd></div>
          <div><dt>Origem</dt><dd>PAM V{item.pamVersion}{item.pam?.source === "EMAIL" ? " (FG 06 anexado ao e-mail)" : ""} · {item.pam ? pamSentText(item.pam) : "—"}</dd></div>
          <div><dt>Ação</dt><dd>{item.kind === "FINAL" ? "Prazo final do PAM — " : "Etapa — "}{item.title}</dd></div>
          <div><dt>Regra original</dt><dd>{describeRule(item, siblings)}</dd></div>
          {predecessor && <div><dt>Depende de</dt><dd>{predecessor.title}</dd></div>}
          {predecessor && <div><dt>Status da predecessora</dt><dd>{predecessor.completed ? `Concluída em ${formatBr(predecessor.completedAt)}` : "Pendente"}</dd></div>}
          <div><dt>Prazo identificado</dt><dd>{item.baseType === "FIXED_DATE" ? `Data expressa: ${formatBr(item.fixedDate)}` : item.quantity === null ? "Não identificado" : `${item.quantity} ${item.unit === "UTEIS" ? "dias úteis" : "dias corridos"}`}</dd></div>
          <div><dt>Data-base</dt><dd>{baseDescription(item, siblings)}</dd></div>
          <div><dt>Data calculada</dt><dd>{item.calculatedDue ? `${formatBr(item.calculatedDue)}${item.isProjected ? " (projetada)" : ""}` : PENDING_REASONS[item.state] ?? "—"}</dd></div>
          <div><dt>Data atual do Planner</dt><dd><strong>{formatBr(item.due)}</strong>{item.urgency && !item.superseded ? ` · ${URGENCY_LABELS[item.urgency]}` : ""}</dd></div>
          <div><dt>Tipo da data</dt><dd>{DATE_KIND_LABELS[item.dateKind]}</dd></div>
          <div><dt>Situação</dt><dd>{statusLabel}{item.completed ? ` — previsto ${formatBr(item.originalDue ?? item.calculatedDue)}, concluído em ${formatBr(item.completedAt)}` : ""}</dd></div>
        </dl>

        {item.manualAdjust && item.adjustedDue && (
          <div className="pl-audit" role="note">
            <strong>Ajustada manualmente</strong>
            <span>Data original calculada: {formatBr(item.calculatedDue)} · Data atual do Planner: {formatBr(item.adjustedDue)}</span>
            <span>Por {item.adjustedBy?.split(" <")[0] ?? "—"} em {item.adjustedAt ? new Date(item.adjustedAt).toLocaleString("pt-BR") : "—"}</span>
            <span>Motivo: {item.adjustReason}</span>
          </div>
        )}
        {item.superseded && <p className="pl-note">Este prazo foi substituído por um PAM posterior e permanece apenas no histórico.</p>}

        <div className="pl-links">
          <a className="button secondary link-button" href={`/responder/editor?rnc=${item.rncId}`}>Abrir RNC</a>
          <a className="button secondary link-button" href={`/responder/editor?rnc=${item.rncId}&type=PAM`}>Visualizar PAM</a>
          <a className="button secondary link-button" href={`/responder/editor?rnc=${item.rncId}&type=PAM&panel=versions`}>Ver histórico</a>
        </div>

        {!canAdjust && <p className="pl-note">Seu perfil pode visualizar o Planner, mas não pode alterar prazos, dependências ou conclusões.</p>}

        {!readOnly && (
          <div className="pl-actions">
            <details open={!item.completed}>
              <summary>{item.completed ? "Conclusão" : "Marcar como concluído"}</summary>
              {item.completed ? (
                <div className="pl-form">
                  <p>Concluído em {formatBr(item.completedAt)} por {item.completedBy?.split(" <")[0] ?? "—"}.</p>
                  <button type="button" className="button secondary" disabled={busy} onClick={() => onCommitment(item.id, { action: "reopen" })}>Reabrir compromisso</button>
                </div>
              ) : (
                <div className="pl-form">
                  <label>Data real de conclusão<input type="date" value={completeDate} onChange={(event) => setCompleteDate(event.target.value)} /></label>
                  <button type="button" className="button primary" disabled={busy || !completeDate} onClick={() => onCommitment(item.id, { action: "complete", completedAt: completeDate })}>Concluir</button>
                </div>
              )}
            </details>

            {item.baseType === "EXTERNAL_MILESTONE" && (
              <details open={item.state === "AGUARDANDO_MARCO"}>
                <summary>Registrar o marco: {item.milestoneLabel || "informado no PAM"}</summary>
                <div className="pl-form">
                  <label>Data do marco<input type="date" value={milestoneDate} onChange={(event) => setMilestoneDate(event.target.value)} /></label>
                  <button type="button" className="button primary" disabled={busy || !milestoneDate} onClick={() => onCommitment(item.id, { action: "milestone", date: milestoneDate })}>Registrar marco</button>
                </div>
              </details>
            )}

            {item.pam && !item.pam.sentAt && (
              <details open={item.state === "DATA_ENVIO_PENDENTE"}>
                <summary>Informar a data de envio do PAM</summary>
                <div className="pl-form">
                  <label>Data real de envio<input type="date" value={sentDate} onChange={(event) => setSentDate(event.target.value)} /></label>
                  <label>Motivo / fonte da informação<textarea rows={2} value={sentReason} onChange={(event) => setSentReason(event.target.value)} placeholder="Ex.: e-mail enviado em … (não localizado na caixa de saída)" /></label>
                  <button type="button" className="button primary" disabled={busy || !sentDate || sentReason.trim().length < 3} onClick={() => onPam(item.pam!.id, { action: "sent-date", date: sentDate, reason: sentReason })}>Salvar data de envio</button>
                </div>
              </details>
            )}

            <details>
              <summary>Ajustar a data do Planner</summary>
              <div className="pl-form">
                <label>Nova data<input type="date" value={adjustDate} onChange={(event) => setAdjustDate(event.target.value)} /></label>
                <label>Motivo do ajuste (obrigatório)<textarea rows={2} value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)} /></label>
                <div className="pl-form-row">
                  <button type="button" className="button primary" disabled={busy || !adjustDate || adjustReason.trim().length < 3} onClick={() => onCommitment(item.id, { action: "adjust", date: adjustDate, reason: adjustReason })}>Ajustar data</button>
                  {item.manualAdjust && <button type="button" className="button secondary" disabled={busy || adjustReason.trim().length < 3} onClick={() => onCommitment(item.id, { action: "clear-adjust", reason: adjustReason })}>Remover ajuste</button>}
                </div>
                <small>O PAM original não é alterado; a data calculada fica preservada para auditoria.</small>
              </div>
            </details>

            <details>
              <summary>Corrigir a interpretação (prazo, unidade, data-base, dependência)</summary>
              <div className="pl-form">
                <div className="pl-form-row">
                  <label>Prazo<input type="number" min={0} value={rule.quantity} onChange={(event) => setRule({ ...rule, quantity: event.target.value })} /></label>
                  <label>Unidade
                    <select value={rule.unit} onChange={(event) => setRule({ ...rule, unit: event.target.value })}>
                      <option value="CORRIDOS">dias corridos</option><option value="UTEIS">dias úteis</option>
                    </select>
                  </label>
                </div>
                <label>Data-base
                  <select value={rule.baseType} onChange={(event) => setRule({ ...rule, baseType: event.target.value })}>
                    <option value="PAM_SENT_DATE">Envio do PAM</option>
                    <option value="FIXED_DATE">Data expressa</option>
                    <option value="PREDECESSOR_COMPLETION">Conclusão de outra atividade</option>
                    <option value="EXTERNAL_MILESTONE">Marco externo</option>
                  </select>
                </label>
                {rule.baseType === "FIXED_DATE" && <label>Data<input type="date" value={rule.fixedDate} onChange={(event) => setRule({ ...rule, fixedDate: event.target.value })} /></label>}
                {rule.baseType === "PREDECESSOR_COMPLETION" && (
                  <label>Atividade predecessora
                    <select value={rule.predecessorId} onChange={(event) => setRule({ ...rule, predecessorId: event.target.value })}>
                      <option value="">Selecione…</option>
                      {others.map((other) => <option key={other.id} value={other.id}>{other.orderIndex}. {other.title}</option>)}
                    </select>
                  </label>
                )}
                <label>Motivo da correção (obrigatório)<textarea rows={2} value={rule.reason} onChange={(event) => setRule({ ...rule, reason: event.target.value })} /></label>
                <button type="button" className="button primary" disabled={busy || rule.reason.trim().length < 3} onClick={saveRule}>Salvar correção</button>
                <small>A interpretação extraída originalmente fica registrada; o texto do PAM não muda.</small>
              </div>
            </details>
          </div>
        )}
      </div>
    </div>
  );
}
