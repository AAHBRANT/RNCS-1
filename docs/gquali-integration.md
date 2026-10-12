# G-QUALI: leitura de RNCs de Engenharia

GET `/api/integrations/gquali/rncs?afterId=0` retorna contrato v1, source RNCS-1, items e nextCursor (null na última página). Até 100 registros por página, ordenados por ID. Reconciliar todas as páginas em cada ciclo; não inferir exclusão por ausência.

Configuração somente no servidor: `GQUALI_READ_TOKEN` com segredo aleatório de pelo menos 32 caracteres e `GQUALI_WORK_IDS` com IDs reais autorizados separados por vírgulas. Endpoint desativado por padrão (401). Cliente envia `Authorization: Bearer <segredo>`. Não usar cookies de usuário, sessão de configuração ou tokens do Outlook.

O handler filtra obra e tipo Engenharia no banco, não exporta e-mails, anexos, credenciais ou respostas. Não modifica dados, não executa sincronização Outlook e não aprova documentos. A rota exata passa pelo proxy para autenticação própria no handler; demais rotas preservam comportamento.

Publicação e configuração são necessárias antes do uso real. Importador local G-QUALI e autenticação foram desenvolvidos separadamente. Anexos, processamento IA, supervisão do worker e revisão humana serão próximas etapas; esta alteração não os ativa.
