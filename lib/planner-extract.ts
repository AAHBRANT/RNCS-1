import { type BaseType, type DeadlineUnit, isIsoDate } from "./planner-calc";

export type ExtractedCommitment = {
  order: number;
  title: string;
  originalText: string;
  kind: "FINAL" | "ETAPA";
  quantity: number | null;
  unit: DeadlineUnit;
  baseType: BaseType;
  fixedDate: string | null;
  milestoneLabel: string | null;
  predecessorOrder: number | null;
  itemNumber: number | null;
  needsReview: boolean;
  reviewReason: string | null;
  source: "PROPOSTA" | "PRAZO";
};

const FOLD: Record<string, string> = {
  á: "a", à: "a", â: "a", ã: "a", ä: "a", é: "e", è: "e", ê: "e", ë: "e", í: "i", ì: "i", î: "i", ï: "i",
  ó: "o", ò: "o", ô: "o", õ: "o", ö: "o", ú: "u", ù: "u", û: "u", ü: "u", ç: "c", ñ: "n",
};

// Minúsculas e sem acentos, sempre com o mesmo comprimento do texto original (índices alinhados).
function fold(value: string) {
  return value.toLowerCase().replace(/[áàâãäéèêëíìîïóòôõöúùûüçñ]/g, (char) => FOLD[char]);
}

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  onze: 11, doze: 12, quinze: 15, vinte: 20, trinta: 30, quarenta: 40, sessenta: 60, noventa: 90,
};
const NUMWORD = String.raw`(?:um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze|quinze|vinte|trinta|quarenta|sessenta|noventa)`;
const MONTHS = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

const CONNECT = String.raw`(?:(?:em\s+ate|em\s+no\s+maximo|no\s+maximo|dentro\s+d[aeo]s?|no\s+prazo\s+maximo\s+de|no\s+prazo\s+de|prazo\s+maximo\s+de|prazo\s+de|prazo\s*:|ate|em)\s+)?`;
const QTY_DIGITS = new RegExp(String.raw`${CONNECT}(?:${NUMWORD}\s*\(\s*)?(\d{1,3})\s*\)?\s*(dias?|semanas?|meses|mes)\b(?:\s+(uteis|corridos|util|corrido))?`, "g");
const QTY_WORDS = new RegExp(String.raw`${CONNECT}\b(${NUMWORD})\s+(dias?|semanas?)\b(?:\s+(uteis|corridos|util|corrido))?`, "g");
const ABS_PREFIX = String.raw`(?:(?:em\s+ate|ate\s+o\s+dia|ate\s+a\s+data\s+de|ate\s+o|ate|no\s+dia|para\s+o\s+dia|dia|em|para)\s+)?`;
const ABS_NUMERIC = new RegExp(String.raw`${ABS_PREFIX}(\d{1,2})\s*[\/.\-]\s*(\d{1,2})\s*[\/.\-]\s*(\d{4}|\d{2})(?!\d)`, "g");
const ABS_TEXT = new RegExp(String.raw`${ABS_PREFIX}(\d{1,2})\s+de\s+(${MONTHS.join("|")})(?:\s+de\s+(\d{4}))?`, "g");
const ABS_SHORT = new RegExp(String.raw`(?:em\s+ate|ate\s+o\s+dia|ate|no\s+dia|para\s+o\s+dia|dia|em|para)\s+(\d{1,2})\s*\/\s*(\d{1,2})(?![\/\d])`, "g");
const AFTER_MARKER = /^\s*,?\s*(?:para\s+cada\s+\w+\s+)?(?:apos|depois\s+d[aeo]s?|a\s+contar\s+d[aeo]s?|a\s+partir\s+d[aeo]s?|contados?\s+d[aeo]s?|contado\s+a\s+partir\s+d[aeo]s?)\s+/;

type Token =
  | { type: "QTY"; start: number; end: number; quantity: number | null; unit: DeadlineUnit; unsupported: boolean }
  | { type: "DATE"; start: number; end: number; date: string | null; yearAssumed: boolean };

function validIso(year: number, month: number, day: number) {
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

function findTokens(folded: string, referenceYear: number): Token[] {
  const found: Token[] = [];
  const regexes: Array<[RegExp, (match: RegExpExecArray) => Token]> = [
    [ABS_NUMERIC, (m) => {
      const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      return { type: "DATE", start: m.index, end: m.index + m[0].length, date: validIso(year, Number(m[2]), Number(m[1])), yearAssumed: false };
    }],
    [ABS_TEXT, (m) => {
      const year = m[3] ? Number(m[3]) : referenceYear;
      return { type: "DATE", start: m.index, end: m.index + m[0].length, date: validIso(year, MONTHS.indexOf(m[2]) + 1, Number(m[1])), yearAssumed: !m[3] };
    }],
    [ABS_SHORT, (m) => ({ type: "DATE", start: m.index, end: m.index + m[0].length, date: validIso(referenceYear, Number(m[2]), Number(m[1])), yearAssumed: true })],
    [QTY_DIGITS, (m) => qtyToken(m, Number(m[1]))],
    [QTY_WORDS, (m) => qtyToken(m, NUMBER_WORDS[m[1]] ?? null)],
  ];
  for (const [regex, build] of regexes) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(folded))) {
      if (match[0].length === 0) { regex.lastIndex += 1; continue; }
      found.push(build(match));
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept: Token[] = [];
  for (const token of found) {
    const previous = kept.at(-1);
    if (previous && token.start < previous.end) continue;
    kept.push(token);
  }
  return kept;
}

function qtyToken(match: RegExpExecArray, quantity: number | null): Token {
  const unitWord = match[2];
  const modifier = match[3] || "";
  const unsupported = /^mes/.test(unitWord);
  const weeks = /^semana/.test(unitWord);
  return {
    type: "QTY",
    start: match.index,
    end: match.index + match[0].length,
    quantity: unsupported || quantity === null ? null : weeks ? quantity * 7 : quantity,
    unit: /^(?:uteis|util)/.test(modifier) ? "UTEIS" : "CORRIDOS",
    unsupported,
  };
}

function splitSentences(line: string) {
  const parts: Array<{ start: number; end: number }> = [];
  let start = 0;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const betweenDigits = char === "." && /\d/.test(line[index - 1] || "") && /\d/.test(line[index + 1] || "");
    const boundary = char === ";" || (char === "." && !betweenDigits && (index === line.length - 1 || /\s/.test(line[index + 1])));
    if (boundary) { parts.push({ start, end: index }); start = index + 1; }
  }
  if (start < line.length) parts.push({ start, end: line.length });
  return parts.filter((part) => line.slice(part.start, part.end).trim());
}

const LEADING_VERBS = /^(?:sera\s+realizad[ao]s?|serao\s+realizad[ao]s?|sera\s+executad[ao]s?|serao\s+executad[ao]s?|sera|serao|devera\s+ser|deverao\s+ser|devera|deverao|ficara|ficarao)\s+(?:a\s+|o\s+|as\s+|os\s+)?/;

function cleanTitle(raw: string) {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^[\s•*\-–—]+/, "").replace(/^\d{1,2}\s*[-–—.):]\s*/, "");
  for (let guard = 0; guard < 6; guard++) {
    const before = text;
    text = text.replace(/^(?:e|ou|,|;|:|-|–|—)\s+/i, "").replace(/^[,;:\-–—]+\s*/, "");
    const folded = fold(text);
    const verb = LEADING_VERBS.exec(folded);
    if (verb) text = text.slice(verb[0].length);
    if (text === before) break;
  }
  text = text.replace(/[\s,;:\-–—]+$/, "").replace(/\s+(?:em|ate|de|no|na|para|a|e)$/i, "").replace(/[\s,;:\-–—]+$/, "").trim();
  for (let guard = 0; guard < 4; guard++) {
    const before = text;
    text = text
      .replace(/[\s|–—-]+(?:prazo(?:\s+m[aá]ximo)?|meta\s+referencial)\s*:?\s*$/i, "")
      .replace(/[\s|–—-]+(?:etapa\s+)?conclu[ií]d[ao]\s*$/i, "")
      .replace(/[\s,;:|–—-]+$/, "");
    if (text === before) break;
  }
  if (!text) return "";
  const capped = text.length > 140 ? `${text.slice(0, 137)}…` : text;
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

const NO_ACTION_REASON = "Não foi possível identificar a ação relacionada ao prazo.";

type Pending = ExtractedCommitment & { refItem: number | null; refPrevious: boolean; marcoText: string; hintWords: string | null };

function significantWords(text: string) {
  return fold(text).split(/[^a-z0-9]+/).filter((word) => word.length >= 5);
}

function classifyMarco(marcoOriginal: string): {
  baseType: BaseType; refItem: number | null; refPrevious: boolean; label: string | null; hint: string | null;
} {
  const marco = fold(marcoOriginal).replace(/\s+/g, " ").trim();
  const label = marcoOriginal.replace(/^(?:a|o|as|os|da|do|das|dos)\s+/i, "").replace(/[\s.,;]+$/, "").trim();
  if (/(envio|encaminhamento|protocolo)\s+(d[aeo]s?\s+)?(pam|plano|proposta|presente|este|esse|documento)/.test(marco) || /^(o\s+|do\s+)?envio\.?$/.test(marco)) {
    return { baseType: "PAM_SENT_DATE", refItem: null, refPrevious: false, label: null, hint: null };
  }
  const item = /(?:atividade|item|etapa|fase|passo|acao|tarefa)\s*(?:n[o°º.]*\s*)?(\d{1,2})/.exec(marco);
  if (item && /(conclus|termino|finaliza|execucao|realizacao)/.test(marco)) {
    return { baseType: "PREDECESSOR_COMPLETION", refItem: Number(item[1]), refPrevious: false, label, hint: null };
  }
  if (/(conclus|termino|finaliza)\w*\s+d[aeo]s?\s+(?:atividade|item|etapa|fase|passo|acao|tarefa)?\s*anterior/.test(marco) || /(?:atividade|item|etapa|fase|passo|acao|tarefa)\s+anterior/.test(marco)) {
    return { baseType: "PREDECESSOR_COMPLETION", refItem: null, refPrevious: true, label, hint: null };
  }
  const conclusion = /(?:conclus|termino|finaliza)\w*\s+(?:d[aeo]s?\s+)?(.+)/.exec(marco);
  if (conclusion) {
    return { baseType: "PREDECESSOR_COMPLETION", refItem: null, refPrevious: false, label, hint: conclusion[1] };
  }
  return { baseType: "EXTERNAL_MILESTONE", refItem: null, refPrevious: false, label, hint: null };
}

function parseText(text: string, options: { referenceYear: number; source: "PROPOSTA" | "PRAZO" }): Pending[] {
  const out: Pending[] = [];
  const lines = text.normalize("NFC").split(/\r?\n/);
  for (const line of lines) {
    const itemMatch = /^\s*(?:item\s*)?(\d{1,2})\s*[-–—.):]\s+/i.exec(line);
    const itemNumber = itemMatch ? Number(itemMatch[1]) : null;
    let pendingTitle = "";
    for (const sentence of splitSentences(line)) {
      const raw = line.slice(sentence.start, sentence.end);
      const folded = fold(raw);
      const tokens = findTokens(folded, options.referenceYear);
      if (!tokens.length) {
        const cleaned = cleanTitle(raw);
        if (cleaned) pendingTitle = cleaned;
        continue;
      }
      let cursor = 0;
      tokens.forEach((token, index) => {
        const next = tokens[index + 1];
        const limit = next ? next.start : raw.length;
        let consumedEnd = token.end;
        let marco: { baseType: BaseType; refItem: number | null; refPrevious: boolean; label: string | null; hint: string | null } | null = null;
        let marcoText = "";

        if (token.type === "QTY") {
          const rest = folded.slice(token.end, limit);
          const marker = AFTER_MARKER.exec(rest);
          if (marker) {
            const from = token.end + marker[0].length;
            let to = limit;
            const comma = folded.slice(from, limit).search(/[,;]/);
            if (comma >= 0) to = from + comma;
            if (next) {
              const joiners = [...folded.slice(from, to).matchAll(/\s+e\s+/g)];
              const last = joiners.at(-1);
              if (last && last.index !== undefined) to = from + last.index;
            }
            marcoText = raw.slice(from, to).trim();
            consumedEnd = to;
            marco = classifyMarco(marcoText);
          }
        }

        const titleRaw = raw.slice(cursor, token.start);
        let title = cleanTitle(titleRaw);
        let reviewReason: string | null = null;
        let usedPending = false;
        if (!title && !next && consumedEnd < raw.length) {
          title = cleanTitle(raw.slice(consumedEnd, limit));
          consumedEnd = limit;
        }
        if (!title && pendingTitle) { title = pendingTitle; usedPending = true; }
        if (!title) { title = `Compromisso ${out.length + 1}`; reviewReason = NO_ACTION_REASON; }
        if (!reviewReason && /conclu[ií]d[ao]/i.test(titleRaw)) reviewReason = "Item informado como já concluído no PAM; confirme e registre a conclusão.";
        cursor = consumedEnd;

        const clause = raw.slice(Math.max(0, token.start - titleRaw.length), consumedEnd).trim();
        const originalText = (usedPending ? `${pendingTitle}. ${clause}` : clause.length >= 12 ? clause : raw.trim()).replace(/\s+/g, " ");

        const common = { order: 0, title, originalText, kind: "ETAPA" as const, itemNumber, source: options.source, refItem: null as number | null, refPrevious: false, marcoText: "", hintWords: null as string | null, predecessorOrder: null as number | null };
        if (token.type === "DATE") {
          const review = token.date === null ? "Data inválida no texto." : token.yearAssumed ? "Ano não informado; considerado o ano do PAM." : null;
          out.push({ ...common, quantity: null, unit: "CORRIDOS", baseType: "FIXED_DATE", fixedDate: token.date, milestoneLabel: null, needsReview: Boolean(reviewReason || review), reviewReason: reviewReason || review });
        } else {
          let baseType: BaseType = "PAM_SENT_DATE";
          let label: string | null = null;
          if (marco) { baseType = marco.baseType; label = marco.baseType === "PAM_SENT_DATE" ? null : marco.label; }
          const unsupported = token.unsupported ? "Prazo em meses não é interpretado automaticamente; informe a data." : null;
          out.push({
            ...common, quantity: token.quantity, unit: token.unit, baseType, fixedDate: null, milestoneLabel: label,
            refItem: marco?.refItem ?? null, refPrevious: marco?.refPrevious ?? false, marcoText, hintWords: marco?.hint ?? null,
            needsReview: Boolean(reviewReason || unsupported), reviewReason: reviewReason || unsupported,
          });
        }
        pendingTitle = "";
      });
    }
  }
  return out;
}

function resolvePredecessors(items: Pending[]) {
  items.forEach((item, index) => {
    if (item.baseType !== "PREDECESSOR_COMPLETION") return;
    let predecessor: Pending | undefined;
    if (item.refItem !== null) {
      predecessor = [...items.slice(0, index)].reverse().find((other) => other.itemNumber === item.refItem);
    } else if (item.refPrevious) {
      predecessor = items[index - 1];
    } else if (item.hintWords) {
      const words = significantWords(item.hintWords);
      predecessor = [...items.slice(0, index)].reverse().find((other) => significantWords(other.title).some((word) => words.includes(word)));
    }
    if (predecessor) {
      item.predecessorOrder = predecessor.order;
    } else {
      item.baseType = "EXTERNAL_MILESTONE";
      item.needsReview = true;
      item.reviewReason = item.reviewReason || "Atividade predecessora não localizada; tratado como marco externo.";
    }
  });
}

export function extractCommitments(input: { proposal?: string | null; deadline?: string | null; referenceYear: number }): ExtractedCommitment[] {
  const proposal = parseText(input.proposal || "", { referenceYear: input.referenceYear, source: "PROPOSTA" });
  proposal.forEach((item, index) => { item.order = index + 1; });
  resolvePredecessors(proposal);

  const all: Pending[] = [...proposal];
  const deadline = parseText(input.deadline || "", { referenceYear: input.referenceYear, source: "PRAZO" });
  for (const item of deadline) {
    const twin = proposal.find((other) =>
      other.baseType === item.baseType && other.quantity === item.quantity && other.unit === item.unit
      && other.fixedDate === item.fixedDate && other.predecessorOrder === null && other.milestoneLabel === item.milestoneLabel);
    if (twin) { twin.kind = "FINAL"; continue; }
    const single = deadline.length === 1;
    // O título genérico do prazo final não é uma ação a identificar: descarta o aviso de título não encontrado.
    const titleWarning = item.reviewReason === NO_ACTION_REASON;
    all.push({
      ...item,
      needsReview: titleWarning ? false : item.needsReview,
      reviewReason: titleWarning ? null : item.reviewReason,
      kind: "FINAL",
      title: single || /^compromisso\s+\d+$/i.test(item.title) ? "Prazo final do PAM" : item.title,
      refItem: null, refPrevious: false, hintWords: null,
      baseType: item.baseType === "PREDECESSOR_COMPLETION" ? "EXTERNAL_MILESTONE" : item.baseType,
      order: all.length + 1,
    });
  }

  return all.map((item): ExtractedCommitment => ({
    order: item.order,
    title: item.title,
    originalText: item.originalText,
    kind: item.kind,
    quantity: item.quantity,
    unit: item.unit,
    baseType: item.baseType,
    fixedDate: item.fixedDate,
    milestoneLabel: item.milestoneLabel,
    predecessorOrder: item.predecessorOrder,
    itemNumber: item.itemNumber,
    needsReview: item.needsReview,
    reviewReason: item.reviewReason,
    source: item.source,
  }));
}

export function ruleText(item: Pick<ExtractedCommitment, "quantity" | "unit" | "baseType" | "fixedDate" | "milestoneLabel" | "predecessorOrder">, titleOf: (order: number) => string | null) {
  const unitWord = (amount: number) => (item.unit === "UTEIS" ? (amount === 1 ? "dia útil" : "dias úteis") : (amount === 1 ? "dia" : "dias"));
  const quantity = item.quantity === null ? "prazo não identificado" : `${item.quantity} ${unitWord(item.quantity)}`;
  if (item.baseType === "FIXED_DATE") return item.fixedDate ? `Data expressa no PAM (${item.fixedDate.split("-").reverse().join("/")})` : "Data expressa no PAM";
  if (item.baseType === "PAM_SENT_DATE") return `${quantity} após o envio do PAM`;
  if (item.baseType === "PREDECESSOR_COMPLETION") {
    const title = item.predecessorOrder ? titleOf(item.predecessorOrder) : null;
    return `${quantity} após a conclusão de ${title ? `"${title}"` : "outra atividade"}`;
  }
  return `${quantity} após ${item.milestoneLabel || "marco informado no PAM"}`;
}
