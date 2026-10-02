export type AnalysisResult = {
  status: "Aprovada" | "Reprovada";
  confidence: { score: number; reason: string };
};

function normalizeAnalysisText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function analysisStatusFromEmailBody(body: string): AnalysisResult | null {
  const source = normalizeAnalysisText(body);
  const rejected = [
    /reprovac(?:ao|oes) d(?:a|as) tratativa(?:s)?/,
    /tratativa (?:foi )?(?:reprovad[oa]|nao aprovad[oa]|nao atendid[oa]|nao aceit[oa])/,
    /medidas nao atenderam ao solicitado/,
    /providencias (?:tomadas )?nao estao em conformidade/,
    /necessita (?:de )?correcao/,
    /devera ser reenviad/,
  ].some((pattern) => pattern.test(source));
  if (rejected) {
    return {
      status: "Reprovada",
      confidence: {
        score: 4,
        reason: "Resultado inequívoco identificado no corpo do e-mail oficial de análise; PDF sem resultado extraível.",
      },
    };
  }
  const approved = [
    /aprovac(?:ao|oes) d(?:a|as) tratativa(?:s)?/,
    /tratativa (?:foi )?aprovad[oa]/,
    /medidas atenderam ao solicitado/,
    /providencias (?:tomadas )?estao em conformidade/,
    /tratativa considerada atendid[oa]/,
    /objeto de aprovac(?:ao|oes)/,
  ].some((pattern) => pattern.test(source));
  if (approved) {
    return {
      status: "Aprovada",
      confidence: {
        score: 4,
        reason: "Resultado inequívoco identificado no corpo do e-mail oficial de análise; PDF sem resultado extraível.",
      },
    };
  }
  return null;
}
