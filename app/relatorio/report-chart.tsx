"use client";

import { useState, type KeyboardEvent } from "react";
import {
  REPORT_CATEGORIES,
  REPORT_CATEGORY_LABELS,
  type MonthBucket,
  type ReportCategory,
} from "../../lib/rnc-report";

export const REPORT_COLORS: Record<ReportCategory, string> = {
  aprovadas: "#2f6b4f",
  reprovadas: "#670000",
  outras: "#d6d27a",
};

export type Selection = { monthKey: string; category: ReportCategory };

const W = 1200;
const H = 520;
const M = { left: 56, right: 24, top: 30, bottom: 44 };
const TOOLTIP_ITEMS = 10;

function niceStep(max: number) {
  if (max <= 10) return 2;
  if (max <= 30) return 5;
  if (max <= 60) return 10;
  return 20;
}

function clip(text: string, size: number) {
  return text.length > size ? `${text.slice(0, size - 1)}…` : text;
}

export function ReportChart({ months, selected, onSelect }: {
  months: MonthBucket[];
  selected: Selection | null;
  onSelect: (selection: Selection | null) => void;
}) {
  const [hover, setHover] = useState<{ selection: Selection; left: number; top: number } | null>(null);

  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const maxValue = Math.max(1, ...months.map((month) => month.total));
  const step = niceStep(maxValue);
  const yMax = Math.ceil(maxValue / step) * step;
  const slot = plotW / Math.max(1, months.length);
  const barW = Math.min(46, slot * 0.68);
  const yPos = (value: number) => M.top + plotH - (value / yMax) * plotH;
  const ticks: number[] = [];
  for (let value = 0; value <= yMax; value += step) ticks.push(value);

  function show(selection: Selection, clientX: number, clientY: number) {
    const count = months.find((month) => month.key === selection.monthKey)?.items[selection.category].length ?? 0;
    const height = 96 + Math.min(count, TOOLTIP_ITEMS) * 36;
    const left = Math.min(Math.max(clientX + 16, 8), Math.max(8, window.innerWidth - 346));
    const fitsBelow = clientY + 16 + height <= window.innerHeight;
    const top = fitsBelow ? clientY + 16 : Math.max(8, clientY - height - 12);
    setHover({ selection, left, top });
  }

  function showFromElement(element: Element, selection: Selection) {
    const rect = element.getBoundingClientRect();
    show(selection, rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  const hoveredMonth = hover ? months.find((month) => month.key === hover.selection.monthKey) : null;
  const hoveredItems = hoveredMonth && hover ? hoveredMonth.items[hover.selection.category] : [];

  return (
    <div className="rp-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Quantidade de RNCs recebidas por mês, separadas por situação">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={W - M.right} y1={yPos(tick)} y2={yPos(tick)} stroke={tick === 0 ? "#9aa59f" : "#e4e9e6"} />
            <text x={M.left - 10} y={yPos(tick) + 4} fontSize="12" fill="#6f7c75" textAnchor="end">{tick}</text>
          </g>
        ))}
        {months.map((month, index) => {
          const cx = M.left + slot * index + slot / 2;
          let accumulated = 0;
          return (
            <g key={month.key}>
              {REPORT_CATEGORIES.map((category) => {
                const count = month.items[category].length;
                if (!count) return null;
                const top = yPos(accumulated + count);
                const height = yPos(accumulated) - top;
                accumulated += count;
                const selection: Selection = { monthKey: month.key, category };
                const isSelected = selected?.monthKey === month.key && selected.category === category;
                const dim = (hover && !(hover.selection.monthKey === month.key && hover.selection.category === category))
                  || (!hover && selected && !isSelected);
                return (
                  <g key={category}>
                    <rect
                      className="rp-segment"
                      x={cx - barW / 2} y={top} width={barW} height={height}
                      fill={REPORT_COLORS[category]}
                      opacity={dim ? 0.55 : 1}
                      stroke={isSelected ? "#17211c" : "none"} strokeWidth={isSelected ? 2 : 0}
                      tabIndex={0}
                      role="button"
                      aria-label={`${month.longLabel}, ${REPORT_CATEGORY_LABELS[category]}: ${count} ${count === 1 ? "RNC" : "RNCs"}`}
                      onMouseEnter={(event) => show(selection, event.clientX, event.clientY)}
                      onMouseMove={(event) => show(selection, event.clientX, event.clientY)}
                      onFocus={(event) => showFromElement(event.currentTarget, selection)}
                      onBlur={() => setHover(null)}
                      onClick={() => onSelect(isSelected ? null : selection)}
                      onKeyDown={(event: KeyboardEvent) => {
                        if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(isSelected ? null : selection); }
                        if (event.key === "Escape") onSelect(null);
                      }}
                    />
                    {height >= 16 && (
                      <text x={cx} y={top + height / 2 + 4} fontSize="12" fontWeight="700" textAnchor="middle" pointerEvents="none"
                        fill={category === "outras" ? "#3a3a10" : "#ffffff"}>{count}</text>
                    )}
                  </g>
                );
              })}
              <text x={cx} y={yPos(month.total) - 8} fontSize="13" fontWeight="700" fill={month.total ? "#17211c" : "#9aa59f"} textAnchor="middle" pointerEvents="none">
                {month.total}
              </text>
              <text x={cx} y={M.top + plotH + 22} fontSize="12" fill="#17211c" textAnchor="middle">{month.label}</text>
            </g>
          );
        })}
      </svg>

      {hover && hoveredMonth && (
        <div className="rp-tooltip" style={{ left: hover.left, top: hover.top }} role="tooltip">
          <header>
            <span className="rp-swatch" style={{ background: REPORT_COLORS[hover.selection.category] }} />
            <strong>{hoveredMonth.longLabel}</strong>
            <small>{REPORT_CATEGORY_LABELS[hover.selection.category]} · {hoveredItems.length} {hoveredItems.length === 1 ? "RNC" : "RNCs"}</small>
          </header>
          <ul>
            {hoveredItems.slice(0, TOOLTIP_ITEMS).map((item) => (
              <li key={item.id}><strong>RNC {item.number}/{item.year}</strong><span>{clip(item.description, 52)}</span></li>
            ))}
          </ul>
          {hoveredItems.length > TOOLTIP_ITEMS && <p>+ {hoveredItems.length - TOOLTIP_ITEMS} RNCs · clique para ver todas</p>}
          {hoveredItems.length <= TOOLTIP_ITEMS && <p>Clique para fixar a lista abaixo</p>}
        </div>
      )}
    </div>
  );
}
