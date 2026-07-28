# Controle de RNC

Aplicação web para controlar Relatórios de Não Conformidade por obra, número e ano. Esta primeira versão opera com cadastro manual e deixa o modelo preparado para uma futura integração com uma conta individual do Outlook.

## Funcionalidades da primeira versão

- dashboard com totais por situação e prazo;
- tabela responsiva com filtros por obra, status, tipo, ano e pesquisa textual;
- cadastro e edição manual de RNCs;
- identificador único composto por obra + número + ano;
- cálculo automático da data prevista em cinco dias úteis, desconsiderando sábados e domingos;
- datas independentes de recebimento, envio e retorno;
- responsáveis pela resposta e pela análise;
- observações exclusivamente manuais;
- cores para prazos e status;
- histórico auditável de alterações;
- exportação para Excel (CSV compatível) e PDF pelo diálogo de impressão;
- modelo de dados para e-mails, IDs do Outlook, anexos e indicadores futuros.

## Arquitetura

- interface e rotas serverless: React, TypeScript e App Router;
- banco relacional: SQLite/D1 no ambiente de demonstração;
- migrações: Drizzle ORM;
- integração Microsoft Graph: isolada do frontend e prevista para uma etapa futura;
- credenciais: sempre por variáveis de ambiente, nunca no código.

Para a hospedagem definitiva na Vercel, a camada de persistência deverá apontar para PostgreSQL serverless (por exemplo, Neon ou Vercel Postgres). O modelo relacional atual foi separado para permitir essa troca sem alterar a interface ou as regras de negócio.

## Obras iniciais

- Parque do Roger - Fase II
- Ponte Rio Cuiá
- Compl. Beira Rio

## Desenvolvimento local

Requisitos: Node.js 22 ou superior.

```bash
pnpm install
pnpm run db:generate
pnpm run dev
```

## Variáveis futuras para Microsoft Graph

Nenhuma credencial do Outlook é necessária nesta primeira versão. Quando a sincronização for implementada, serão utilizadas:

```env
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=
MICROSOFT_REDIRECT_URI=
OUTLOOK_ACCOUNT_EMAIL=
```

O frontend nunca receberá tokens ou segredos. A sincronização deverá percorrer Caixa de Entrada, subpastas e Itens Enviados, usando delta queries da Microsoft Graph e persistindo os IDs das mensagens.

## Regras importantes

- envio da resposta não significa aprovação;
- recebimento, envio e retorno preenchem datas diferentes;
- observações não são preenchidas automaticamente;
- feriados ainda não entram no cálculo, mas a função foi isolada para essa evolução;
- o botão **Atualizar e-mails** permanece desabilitado até a integração Graph ser implementada.
