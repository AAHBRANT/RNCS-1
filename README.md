# Controle de RNC

Aplicação web para controlar Relatórios de Não Conformidade por obra, número e ano, com sincronização de uma conta individual do Outlook pela Microsoft Graph.

## Funcionalidades

- dashboard com totais por situação e prazo;
- tabela responsiva com filtros por obra, status, tipo, ano e pesquisa textual;
- cadastro e edição manual de RNCs;
- identificador único composto por obra + número + ano;
- prazo automático de cinco dias úteis, desconsiderando sábados e domingos;
- datas independentes de recebimento, envio e retorno;
- responsáveis pela resposta e pela análise;
- observações exclusivamente manuais;
- cores para prazos e status;
- histórico auditável de alterações;
- exportação para Excel (CSV compatível) e PDF pelo diálogo de impressão;
- modelo para e-mails, IDs do Outlook, anexos e indicadores futuros.

## Arquitetura

- Next.js com App Router, React e TypeScript;
- funções serverless compatíveis com Vercel;
- PostgreSQL serverless, recomendado via Neon no Marketplace da Vercel;
- Drizzle ORM;
- credenciais somente em variáveis de ambiente;
- integração Microsoft Graph isolada do frontend, com OAuth 2.0;
- refresh token criptografado no PostgreSQL com AES-256-GCM;
- leitura incremental da Caixa de Entrada, suas subpastas e Itens Enviados.

O banco e as tabelas são inicializados com segurança no primeiro acesso. Nenhum token ou segredo é enviado ao navegador.

## Obras iniciais

- Parque do Roger - Fase II
- Ponte Rio Cuiá
- Compl. Beira Rio

## Implantação na Vercel

1. Importe este repositório na Vercel.
2. Confirme o preset **Next.js** e mantenha o diretório raiz como `./`.
3. No Marketplace do projeto, instale o **Neon** e vincule um banco PostgreSQL.
4. Confirme que a integração criou a variável `DATABASE_URL`.
5. Faça uma nova implantação.

Não é necessário preencher manualmente Build Command, Output Directory ou Install Command.

## Desenvolvimento local

Requisitos: Node.js 22 ou superior e uma conexão PostgreSQL.

```bash
cp .env.example .env.local
pnpm install
pnpm run dev
```

Preencha `DATABASE_URL` em `.env.local`.

## Variáveis de ambiente

```env
DATABASE_URL=

# Microsoft Graph
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://rncs-1.vercel.app/api/outlook/callback
OUTLOOK_ACCOUNT_EMAIL=
MICROSOFT_TOKEN_ENCRYPTION_KEY=
OUTLOOK_INITIAL_SYNC_DAYS=365
```

`MICROSOFT_TOKEN_ENCRYPTION_KEY` deve ser um valor aleatório de 32 bytes codificado em Base64. Todas as variáveis acima devem ficar somente no backend/Vercel e nunca usar o prefixo `NEXT_PUBLIC_`.

## Conectar o Outlook

1. Registre uma aplicação Web no Microsoft Entra.
2. Autorize contas Microsoft pessoais e organizacionais, conforme a conta escolhida.
3. Cadastre a URI de redirecionamento `https://rncs-1.vercel.app/api/outlook/callback`.
4. Adicione permissões delegadas Microsoft Graph: `User.Read` e `Mail.Read`.
5. Crie um segredo do cliente e configure as variáveis na Vercel.
6. Faça um novo deployment e clique em **Conectar Outlook** uma única vez.

O sistema solicita `offline_access` para renovar o acesso no backend. A aplicação não envia nem altera mensagens. Ela lê metadados e o texto de anexos PDF/DOCX relacionados às RNCs para identificar descrição, responsável e resultado da análise.

## Regras importantes

- o envio da resposta não significa aprovação;
- recebimento, envio e retorno preenchem datas diferentes;
- observações não são preenchidas automaticamente;
- feriados ainda não entram no cálculo;
- mensagens só são associadas automaticamente quando obra, número e ano da RNC podem ser identificados;
- a sincronização pública possui intervalo mínimo de um minuto;
- o controle de edição por usuário será implementado depois da validação da integração Outlook.

## Regras oficiais da sincronização

- Recebimento e retorno somente são aceitos quando o remetente é
  `contato@jampasustentavel.com`.
- A resposta somente é aceita em **Itens Enviados**, destinada ao endereço oficial.
- A correlação usa obra + número + ano, assunto, encadeamento e nomes dos anexos.
- São verificadas a Caixa de Entrada, suas subpastas, a pasta exibida como
  **JAMPA SUSTENTÁVEL**, suas subpastas e Itens Enviados.
- Cada execução registra as pastas verificadas.
- PDF e DOCX são analisados para localizar o responsável e o resultado da análise.
- Campos corrigidos manualmente ficam protegidos contra sobrescrita automática.

## Fluxo provisório de resposta

O botão **Responder RNC** monta o contexto, exige uma diretriz, permite copiar as informações
e abre o agente de RNC em outra aba. O link não transfere dados ou anexos automaticamente.

A geração integrada do Word somente deve ser ativada quando existirem:

1. `OPENAI_API_KEY` configurada exclusivamente no backend;
2. instruções técnicas equivalentes às do agente;
3. o arquivo real `templates/modelo-resposta-rnc.docx`.

Sem esses itens, a aplicação permanece no modo provisório seguro. Nenhum e-mail é enviado
automaticamente.
