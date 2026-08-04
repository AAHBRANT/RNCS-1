import { normalizeForSearch } from "./normalize-pdf-text";

export const RNC_TYPES = ["Engenharia", "Segurança do Trabalho", "Ambiental", "Social"] as const;
export type RncType = typeof RNC_TYPES[number];

export function isValidRncType(value: string): value is RncType {
  return (RNC_TYPES as readonly string[]).includes(value);
}

const KEYWORDS: Record<RncType, string[]> = {
  "Engenharia": [
    "execução dos serviços", "qualidade da obra", "concreto", "alvenaria", "estrutura", "fundação",
    "revestimentos", "revestimento", "cobertura", "impermeabilização",
    "instalações elétricas", "instalação elétrica", "instalações hidrossanitárias", "instalação hidrossanitária",
    "projetos", "projeto", "materiais", "material", "especificações técnicas", "especificação técnica",
    "desempenho da obra", "controle tecnológico",
  ],
  "Segurança do Trabalho": [
    "epi", "epc", "nr", "proteção coletiva", "proteção individual", "risco de acidente",
    "trabalho em altura", "escavações", "escavação", "sinalização de segurança",
    "acidentes", "acidente", "procedimentos de segurança", "procedimento de segurança", "saúde ocupacional",
  ],
  "Ambiental": [
    "resíduos", "resíduo", "descarte", "poluição", "drenagem", "erosão", "vegetação", "fauna", "flora",
    "licenciamento ambiental", "recursos hídricos", "controle ambiental",
  ],
  "Social": [
    "comunidade", "população", "acessibilidade", "impactos sociais", "impacto social",
    "comunicação social", "relacionamento com moradores", "desapropriações", "desapropriação",
    "programas sociais", "programa social",
  ],
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countMatches(normalizedText: string, normalizedKeyword: string) {
  const pattern = new RegExp(`\\b${escapeRegex(normalizedKeyword)}\\b`, "g");
  return (normalizedText.match(pattern) || []).length;
}

/**
 * Classifica o tipo de uma RNC a partir do texto completo do documento
 * (título, descrição, caracterização, recomendações, medidas corretivas etc.),
 * nunca de uma palavra isolada. Retorna `type: null` quando a maior pontuação
 * é zero ou há empate entre as duas categorias mais bem pontuadas — nesses
 * casos a RNC deve ficar pendente de revisão manual em vez de receber um
 * palpite arriscado.
 */
export function classifyRncType(text: string): { type: RncType | null; scores: Record<RncType, number> } {
  const normalized = normalizeForSearch(text);
  const scores = RNC_TYPES.reduce((acc, category) => {
    acc[category] = KEYWORDS[category].reduce(
      (total, keyword) => total + countMatches(normalized, normalizeForSearch(keyword)),
      0,
    );
    return acc;
  }, {} as Record<RncType, number>);

  const ranked = [...RNC_TYPES].sort((a, b) => scores[b] - scores[a]);
  const [best, second] = ranked;
  if (scores[best] === 0 || scores[best] === scores[second]) {
    return { type: null, scores };
  }
  return { type: best, scores };
}
