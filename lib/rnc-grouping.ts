// Sugestão de agrupamento das RNCs reprovadas por assunto, a partir da descrição.
// É só um ponto de partida: a usuária pode renomear, mover e criar grupos livremente.

const norm = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();

// A ordem importa: a primeira regra que combinar define o grupo.
export const SUBJECT_RULES: Array<{ name: string; pattern: RegExp }> = [
  { name: "Cronograma desatualizado", pattern: /CRONOGRAMA/ },
  { name: "Aterro e resíduos", pattern: /ATERRO|\bRCC\b|RESIDUOS/ },
  { name: "Estrutura metálica e oxidação", pattern: /OXIDA|METALIC|ESTURUTURA|PECAS DE ACO|\bACO\b/ },
  { name: "Concretagem e arquibancadas", pattern: /CONCRETA|ADENSAMENTO|ARQUIBANCADA|FISSURA|PILARES|FUNDACA/ },
  { name: "Segurança do trabalho e equipamentos", pattern: /ANDAIME|ALTURA|LINHA DE VIDA|BETONEIRA|SERRA|EQUIPAMENTO|VIVENCIA|SEGURANCA DO TRABALHO/ },
  { name: "Revestimentos, alvenaria e acabamentos", pattern: /REVESTIMENTO|GESSO|UMIDADE|INFILTRA|CERAMIC|ALVENARIA|PLATIBANDA|PORTICO|PORTIDO|COBERTA/ },
  { name: "Projeto, planejamento e gestão", pattern: /PROJETO|PLANEJAMENTO|MAO DE OBRA|CARTA TRACO|CONTINUIDADE|INTERFERENCIA|CLIMATIC/ },
];

export function suggestSubject(description: string): string | null {
  const text = norm(description);
  return SUBJECT_RULES.find((rule) => rule.pattern.test(text))?.name ?? null;
}
