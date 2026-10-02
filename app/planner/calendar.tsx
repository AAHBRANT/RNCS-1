"use client";

import { useState } from "react";
import { URGENCY_LABELS } from "../../lib/planner-calc";
import { DATE_KIND_LABELS, monthGridDays, rncLabel, type PlannerItem, weekDays } from "../../lib/planner-view";

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MONTH_LIMIT = 3;

function marker(item: PlannerItem) {
  if (item.completed) return "✓";
  return item.isProjected ? "○" : "●";
}

function chipClass(item: PlannerItem) {
  const tone = item.superseded ? "SUBSTITUIDO" : item.urgency ?? "SEM";
  return `pl-chip pl-${tone}${item.isProjected && !item.completed ? " projected" : ""}${item.completed ? " done" : ""}`;
}

function chipLabel(item: PlannerItem) {
  const state = item.superseded ? "Substituído por PAM posterior" : item.urgency ? URGENCY_LABELS[item.urgency] : "Sem data";
  return `${rncLabel(item.rnc)} — ${item.title}. ${state}. ${DATE_KIND_LABELS[item.dateKind]}${item.isProjected ? " (data projetada)" : ""}.`;
}

function Chip({ item, onSelect, showTag }: { item: PlannerItem; onSelect: (item: PlannerItem) => void; showTag?: boolean }) {
  return (
    <button type="button" className={chipClass(item)} onClick={() => onSelect(item)} title={chipLabel(item)} aria-label={chipLabel(item)}>
      <span className="pl-marker" aria-hidden="true">{marker(item)}</span>
      <span className="pl-chip-text"><strong>{rncLabel(item.rnc).replace("RNC ", "")}</strong> {item.title}</span>
      {showTag && item.urgency && !item.superseded && <small>{URGENCY_LABELS[item.urgency]}</small>}
    </button>
  );
}

export function PlannerCalendar({ view, cursor, today, byDay, onSelect }: {
  view: "month" | "week";
  cursor: string;
  today: string;
  byDay: Map<string, PlannerItem[]>;
  onSelect: (item: PlannerItem) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const days = view === "month" ? monthGridDays(cursor) : weekDays(cursor);
  const currentMonth = cursor.slice(0, 7);

  return (
    <div className={`pl-calendar ${view}`} role="grid" aria-label={view === "month" ? "Calendário mensal de prazos" : "Calendário semanal de prazos"}>
      {WEEKDAYS.map((name) => <div className="pl-weekday" role="columnheader" key={name}>{name}</div>)}
      {days.map((day) => {
        const items = byDay.get(day) ?? [];
        const outside = view === "month" && day.slice(0, 7) !== currentMonth;
        const visible = view === "month" && expanded !== day ? items.slice(0, MONTH_LIMIT) : items;
        const hidden = items.length - visible.length;
        return (
          <div key={day} role="gridcell" className={`pl-day${outside ? " outside" : ""}${day === today ? " today" : ""}`}>
            <span className="pl-day-number">{Number(day.slice(8))}{day === today && <em> hoje</em>}</span>
            <div className="pl-day-items">
              {visible.map((item) => <Chip key={item.id} item={item} onSelect={onSelect} showTag={view === "week"} />)}
              {hidden > 0 && <button type="button" className="pl-more" onClick={() => setExpanded(day)}>+{hidden} {hidden === 1 ? "compromisso" : "compromissos"}</button>}
              {expanded === day && items.length > MONTH_LIMIT && <button type="button" className="pl-more" onClick={() => setExpanded(null)}>mostrar menos</button>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
