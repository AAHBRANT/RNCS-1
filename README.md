# Controle de RNC

Aplicação web para controlar Relatórios de Não Conformidade por obra, número e ano. A primeira versão opera com cadastro manual e está preparada para futura integração com uma conta individual do Outlook.

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
- futura integração Microsoft Graph isolada do frontend.

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

# Futuras credenciais Microsoft Graph
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=
OUTLOOK_ACCOUNT_EMAIL=
```

## Regras importantes

- o envio da resposta não significa aprovação;
- recebimento, envio e retorno preenchem datas diferentes;
- observações não são preenchidas automaticamente;
- feriados ainda não entram no cálculo;
- o botão **Atualizar e-mails** permanece desabilitado até a integração Graph.
