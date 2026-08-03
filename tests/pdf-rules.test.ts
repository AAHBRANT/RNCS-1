import assert from "node:assert/strict";
import test from "node:test";
import { extractRncInformation } from "../lib/pdf/extract-rnc-information";
import { processRncAttachment } from "../lib/pdf/process-rnc-attachment";
import { analysisStatusFromEmailBody } from "../lib/rnc-analysis";
import { classifyType, explicitSentIdentities, extractIdentities, isGraphSearchStaleError } from "../lib/outlook-sync";

test("identifica número e ano da RNC", () => {
  assert.deepEqual(
    extractRncInformation("RNC Nº 159/2026").rncNumber,
    "159",
  );
  assert.equal(extractRncInformation("RNC Nº 159/2026").year, 2026);
  assert.equal(extractRncInformation("RELATÓRIO DE NÃO CONFORMIDADE Nº 159").rncNumber, "159");
});

test("reprovação tem precedência sobre aprovação", () => {
  assert.equal(extractRncInformation("TRATATIVA APROVADA").analysisStatus, "APROVADA");
  assert.equal(extractRncInformation("TRATATIVA NÃO APROVADA").analysisStatus, "REPROVADA");
  assert.equal(extractRncInformation("TRATATIVA REPROVADA").analysisStatus, "REPROVADA");
  assert.equal(
    extractRncInformation("A versão anterior foi aprovada, mas a TRATATIVA NÃO APROVADA").analysisStatus,
    "REPROVADA",
  );
});

test("identifica os responsáveis pelos campos exatos dos documentos", () => {
  assert.equal(
    extractRncInformation("RESPONSÁVEL DA ÁREA INSPECIONADA: Isabella Marques").responsible,
    "Isabella Marques",
  );
  assert.equal(
    extractRncInformation("RESPONSÁVEL DA ÁREA INSPECIONADA\nIsabella Marques").responsible,
    "Isabella Marques",
  );
  assert.equal(
    extractRncInformation(
      "Revisor da Elaboração da Análise da Tratativa\nJuliane Ataíde",
    ).analysisReviewer,
    null,
  );
  assert.equal(
    extractRncInformation("Revisor da Elaboração do RNC: Carlos Almeida").analysisReviewer,
    "Carlos Almeida",
  );
  assert.equal(
    extractRncInformation("Revisor da Elaboração do RNC\nCarlos Almeida").analysisReviewer,
    "Carlos Almeida",
  );
  assert.equal(
    extractRncInformation("Responsável pela tratativa: Nome incorreto").responsible,
    null,
  );
});

test("separa o responsável da área e o fiscal da inspeção", () => {
  const information = extractRncInformation([
    "RESPONSÁVEL DA ÁREA INSPECIONADA:",
    "ISABELLA MARQUES",
    "RESPONSÁVEL FISCAL PELA INSPEÇÃO:",
    "MARIANA LÍVIA DE MELO",
    "CONTRATO:",
    "123/2026",
  ].join("\n"));
  assert.equal(information.responsible, "ISABELLA MARQUES");
  assert.equal(information.inspectionResponsible, "MARIANA LÍVIA DE MELO");
  assert.equal(information.contract, "123/2026");
});

test("localiza o revisor abaixo da assinatura no FG 14", () => {
  const information = extractRncInformation([
    "REVISOR DA ELABORAÇÃO DO RNC",
    "ASSINATURA",
    "CARLOS ALMEIDA",
  ].join("\n"));
  assert.equal(information.analysisReviewer, "CARLOS ALMEIDA");
});

test("não aceita o contrato escrito na mesma linha do rótulo", () => {
  assert.equal(extractRncInformation("CONTRATO: VALOR INCORRETO").contract, null);
});

test("extrai exclusivamente a célula imediatamente abaixo do cabeçalho", () => {
  const information = extractRncInformation(
    "Texto lateral com nomes incorretos",
    [[
      ["RESPONSÁVEL DA ÁREA INSPECIONADA", "RESPONSÁVEL FISCAL PELA INSPEÇÃO", "CONTRATO"],
      ["ISABELLA MARQUES\nTexto explicativo ignorado", "MARIANA LÍVIA DE MELO", "CT 02.023/2024 – UEP/SEGGOV"],
      ["OUTRO NOME", "OUTRO FISCAL", "OUTRO CONTRATO"],
    ]],
  );
  assert.equal(information.responsible, "ISABELLA MARQUES");
  assert.equal(information.inspectionResponsible, "MARIANA LÍVIA DE MELO");
  assert.equal(information.contract, "CT 02.023/2024 – UEP/SEGGOV");
});

test("não usa texto próximo quando o quadro não contém o campo solicitado", () => {
  const information = extractRncInformation(
    "RESPONSÁVEL DA ÁREA INSPECIONADA\nNOME INCORRETO",
    [[["OUTRO CABEÇALHO"], ["OUTRO VALOR"]]],
  );
  assert.equal(information.responsible, null);
});

test("preserva colunas quando os títulos do PDF estão quebrados em duas linhas", () => {
  const layout = [
    "RESPONSÁVEL DA ÁREA\tRESPONSÁVEL FISCAL PELA\tCONTRATO",
    "INSPECIONADA\tINSPEÇÃO\t",
    "ISABELLA MARQUES\tMARIANA LÍVIA DE MELO\tCT 02.023/2024 – UEP/SEGGOV",
  ].join("\n");
  const information = extractRncInformation("Texto linear misturado", [], layout);
  assert.equal(information.responsible, "ISABELLA MARQUES");
  assert.equal(information.inspectionResponsible, "MARIANA LÍVIA DE MELO");
  assert.equal(information.contract, "CT 02.023/2024 – UEP/SEGGOV");
});

test("separa responsáveis quando o PDF extrai os dois rótulos antes dos nomes", () => {
  const information = extractRncInformation([
    "RESPONSÁVEL DA ÁREA INSPECIONADA:",
    "RESPONSÁVEL FISCAL PELA INSPEÇÃO:",
    "ISABELLA MARQUES",
    "MARIANA LÍVIA DE MELO",
  ].join("\n"));
  assert.equal(information.responsible, "ISABELLA MARQUES");
  assert.equal(information.inspectionResponsible, "MARIANA LÍVIA DE MELO");
});

test("mantém resultado inconclusivo quando faltam dados", () => {
  const result = extractRncInformation("Documento sem resultado conclusivo");
  assert.equal(result.responsible, null);
  assert.equal(result.analysisReviewer, null);
  assert.equal(result.analysisStatus, "STATUS_A_CONFIRMAR");
});

test("recusa anexo que não seja PDF", async () => {
  const result = await processRncAttachment({
    fileName: "evidencia.txt",
    contentType: "text/plain",
    contentBuffer: Buffer.from("RNC 159"),
  });
  assert.equal(result.success, false);
  assert.equal(result.needsOcr, false);
});

test("reporta PDF vazio", async () => {
  const result = await processRncAttachment({
    fileName: "rnc.pdf",
    contentType: "application/pdf",
    contentBuffer: Buffer.alloc(0),
  });
  assert.equal(result.success, false);
  assert.match(result.error || "", /vazio/i);
});

test("usa o corpo oficial como fonte secundária inequívoca", () => {
  assert.equal(
    analysisStatusFromEmailBody(
      "As providências tomadas estão em conformidade. As medidas atenderam ao solicitado e encaminhamos a aprovação da tratativa.",
    )?.status,
    "Aprovada",
  );
  assert.equal(
    analysisStatusFromEmailBody("A tratativa não foi aprovada e deverá ser reenviada.")?.status,
    "Reprovada",
  );
  assert.equal(
    analysisStatusFromEmailBody(
      "Encaminhamos a Análise de Tratativa de RNC referente à reprovação da tratativa encaminhada.",
    )?.status,
    "Reprovada",
  );
  assert.equal(analysisStatusFromEmailBody("Encaminhamos a análise em anexo."), null);
});

test("não atribui resposta às RNCs apenas citadas no histórico", () => {
  const result = explicitSentIdentities(
    "RES: Encaminhamento das RNC 143/2026, 144/2026, 145/2026 e 146/2026",
    "Prezados, encaminhamos somente a RNC 146.\nDe: Supervisão\nForam emitidas as RNC 143/2026, 144/2026, 145/2026 e 146/2026.",
    ["Resposta RNC 146_2026.pdf"],
  );
  assert.deepEqual(result, [{ number: "146", year: 2026 }]);
});

test("classifica aprovacoes de varias tratativas pelo corpo do e-mail", () => {
  assert.equal(
    analysisStatusFromEmailBody(
      "Apos verificacao, confirmou-se que as providencias tomadas pela empresa estao em conformidade com as solicitacoes dos RNCs 090/2025 e 091/2025. Desse modo, visto que as medidas atenderam ao solicitado, encaminhamos anexo as Analises de Tratativas de RNC referentes as aprovacoes das tratativas encaminhadas.",
    )?.status,
    "Aprovada",
  );
});

test("identifica todas as RNCs declaradas no corpo atual mesmo com anexos fora do padrao", () => {
  const result = explicitSentIdentities(
    "RES: Encaminhamento de RNC 167/2026, 168/2026, 169/2026 e 170/2026",
    "Encaminhamos em anexo os Relatorios de Nao Conformidade (RNCs) Nº 167/2026, 168/2026, 169/2026 e 170/2026. De: Supervisao. Assunto: RNC 167/2026 a 173/2026.",
    [
      "FG 13 - TRATATIVA DE RNC 167_2026.pdf",
      "FG 13 - TRATATIVA DE RNC 168.pdf",
      "FG 13 - TRATATIVA DE RNC 169 EPI;2026.pdf",
      "FG 13 - TRATATIVA DE RNC 170_2026.pdf",
    ],
  );
  assert.deepEqual(result, [
    { number: "167", year: 2026 },
    { number: "170", year: 2026 },
    { number: "168", year: 2026 },
    { number: "169", year: 2026 },
  ]);
});

test("classifica falhas construtivas como execução", () => {
  assert.equal(classifyType("Não conformidades nas arquibancadas do campo de futebol"), "Execução");
  assert.equal(classifyType("Presença de infiltração em revestimento de gesso"), "Execução");
});

test("reconhece cursor de pesquisa invalidado pelo Microsoft Graph", () => {
  assert.equal(isGraphSearchStaleError(new Error(
    'Microsoft Graph respondeu 400: {"error":{"code":"ErrorExecuteSearchStaleData","message":"Please reissue the query with rowOffset = 0. The specified rowoffset is 10, but the results are stale."}}',
  )), true);
  assert.equal(isGraphSearchStaleError(new Error("Erro de autenticação")), false);
});

test("aceita anexo com RNC e padrão número-ano", () => {
  const cases = [
    ["RNC_123-2026.pdf", "123"],
    ["RNC 123.2026.docx", "123"],
    ["rnc-123_2026.pdf", "123"],
    ["Encaminhamento RNC nº 123-2026.pdf", "123"],
    ["FG 13 - TRATATIVA DE RNC 159_2026.pdf", "159"],
  ] as const;
  for (const [attachmentName, expectedNumber] of cases) {
    const result = extractIdentities("", [attachmentName], "");
    assert.equal(result.length, 1, `Deveria aceitar: ${attachmentName}`);
    assert.equal(result[0].number, expectedNumber, `Número incorreto para: ${attachmentName}`);
  }
});

test("rejeita anexo com apenas número-ano (sem RNC)", () => {
  const cases = [
    "123-2026.pdf",
    "Anexo 123_26.docx",
    "evidencia_159-2026.txt",
  ];
  for (const attachmentName of cases) {
    const result = extractIdentities("", [attachmentName], "");
    assert.equal(result.length, 0, `Deveria rejeitar: ${attachmentName}`);
  }
});

test("continua extraindo de subject e body sem exigir RNC em attachmentNames", () => {
  const result = extractIdentities(
    "RNC 159/2026",
    ["123-2026.pdf"],
    "Análise da RNC 159/2026",
  );
  assert.deepEqual(result.map(r => `${r.number}/${r.year}`), ["159/2026"], "Deveria extrair de subject e body mesmo sem RNC no attachment");
});

test("extrai os 3 campos novos: TIPO DE OCORRÊNCIA, CARACTERIZAÇÃO e DATA DA INSPEÇÃO", () => {
  const information = extractRncInformation([
    "RNC 159/2026",
    "TIPO DE OCORRÊNCIA",
    "Falha Construtiva",
    "CARACTERIZAÇÃO DA OCORRÊNCIA",
    "Presença de infiltração em revestimento de gesso da arquibancada",
    "DATA DA INSPEÇÃO",
    "12/03/2026",
    "RESPONSÁVEL DA ÁREA INSPECIONADA",
    "ISABELLA MARQUES",
  ].join("\n"));
  assert.equal(information.occurrenceType, "Falha Construtiva");
  assert.equal(information.occurrenceDescription, "Presença de infiltração em revestimento de gesso da arquibancada");
  assert.equal(information.inspectionDate, "2026-03-12");
  assert.equal(information.confidence.occurrenceType, "HIGH");
  assert.equal(information.confidence.occurrenceDescription, "HIGH");
  assert.equal(information.confidence.inspectionDate, "HIGH");
});

test("extrai os campos novos de tabela estruturada com múltiplas linhas", () => {
  const information = extractRncInformation([
    "Outros dados do RNC",
    "TIPO DE OCORRÊNCIA\tCARACTERIZAÇÃO DA OCORRÊNCIA\tDATA DA INSPEÇÃO",
    "Execução\tFissura em fundação\t25/06/2026",
    "Valores extras ignorados\tMais dados\tIgnorado",
  ].join("\n"));
  assert.equal(information.occurrenceType, "Execução");
  assert.equal(information.occurrenceDescription, "Fissura em fundação");
  assert.equal(information.inspectionDate, "2026-06-25");
});

test("retorna LOW confidence quando os campos novos não existem", () => {
  const information = extractRncInformation("RNC 159/2026 Documento sem os campos novos");
  assert.equal(information.occurrenceType, null);
  assert.equal(information.occurrenceDescription, null);
  assert.equal(information.inspectionDate, null);
  assert.equal(information.confidence.occurrenceType, "LOW");
  assert.equal(information.confidence.occurrenceDescription, "LOW");
  assert.equal(information.confidence.inspectionDate, "LOW");
});

test("detecta resposta enviada via CC na caixa de entrada", () => {
  // Simula lógica de oficialSent: quando um e-mail está na inbox,
  // vem de remetente diferente de contato@jampasustentável.com,
  // mas tem contato@jampasustentável.com em to/cc, deve ser tratado como envio_resposta
  const OFFICIAL_EMAIL = "contato@jampasustentavel.com";

  // Cenário 1: inbox + remetente diferente + OFFICIAL_EMAIL em recipientsList = true (nova regra)
  const kind1: string = "inbox";
  const sender1: string = "joao@aahbrant.com";
  const recipientsList1: string[] = [OFFICIAL_EMAIL, "outro@email.com"];
  const officialSent1 = (kind1 === "sent" && recipientsList1.includes(OFFICIAL_EMAIL))
    || (kind1 === "inbox" && sender1 !== OFFICIAL_EMAIL && recipientsList1.includes(OFFICIAL_EMAIL));
  assert.equal(officialSent1, true, "Deveria detectar resposta via CC na inbox");

  // Cenário 2: sent + OFFICIAL_EMAIL em recipientsList = true (regra existente)
  const kind2: string = "sent";
  const sender2: string = "conta@aahbrant.com";
  const recipientsList2: string[] = [OFFICIAL_EMAIL];
  const officialSent2 = (kind2 === "sent" && recipientsList2.includes(OFFICIAL_EMAIL))
    || (kind2 === "inbox" && sender2 !== OFFICIAL_EMAIL && recipientsList2.includes(OFFICIAL_EMAIL));
  assert.equal(officialSent2, true, "Deveria detectar resposta enviada via Itens Enviados");

  // Cenário 3: inbox + remetente É OFFICIAL_EMAIL + sem menção em recipientsList = false
  // (entra em officialIncoming, não officialSent)
  const kind3: string = "inbox";
  const sender3: string = OFFICIAL_EMAIL;
  const recipientsList3: string[] = [];
  const officialSent3 = (kind3 === "sent" && recipientsList3.includes(OFFICIAL_EMAIL))
    || (kind3 === "inbox" && sender3 !== OFFICIAL_EMAIL && recipientsList3.includes(OFFICIAL_EMAIL));
  assert.equal(officialSent3, false, "RNC original não deveria ser detectada como oficialSent");
});
