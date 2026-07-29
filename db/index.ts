import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function connectionString() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error("DATABASE_URL não configurada. Conecte um banco Neon ao projeto na Vercel.");
  }
  return value;
}

export function getDb() {
  return drizzle(neon(connectionString()), { schema });
}

let initialization: Promise<void> | undefined;

export function ensureDatabase() {
  initialization ??= initializeDatabase().catch((error) => {
    initialization = undefined;
    throw error;
  });
  return initialization;
}

async function initializeDatabase() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      await initializeDatabaseOnce();
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const concurrentDdl =
        message.includes("pg_type_typname_nsp_index") ||
        message.includes("duplicate key value violates unique constraint");

      if (!concurrentDdl || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 300));
    }
  }
}

async function initializeDatabaseOnce() {
  const sql = neon(connectionString());
  await sql`CREATE TABLE IF NOT EXISTS works (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rncs (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    number TEXT NOT NULL,
    year INTEGER NOT NULL,
    description TEXT NOT NULL DEFAULT 'Descrição não identificada',
    type TEXT NOT NULL DEFAULT 'A classificar',
    received_at TEXT NOT NULL,
    due_at TEXT NOT NULL,
    sent_at TEXT,
    returned_at TEXT,
    status TEXT NOT NULL DEFAULT 'Recebida',
    notes TEXT NOT NULL DEFAULT '',
    response_owner TEXT NOT NULL DEFAULT '',
    analysis_owner TEXT NOT NULL DEFAULT '',
    field_sources TEXT NOT NULL DEFAULT '{}',
    field_confidence TEXT NOT NULL DEFAULT '{}',
    manual_fields TEXT NOT NULL DEFAULT '[]',
    source_summary TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rncs_work_number_year_unique UNIQUE(work_id, number, year)
  )`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS field_sources TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS field_confidence TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS manual_fields TEXT NOT NULL DEFAULT '[]'`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS source_summary TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rncs ALTER COLUMN received_at DROP NOT NULL`;
  await sql`ALTER TABLE rncs ALTER COLUMN due_at DROP NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS rncs_status_idx ON rncs(status)`;
  await sql`CREATE INDEX IF NOT EXISTS rncs_due_at_idx ON rncs(due_at)`;
  await sql`CREATE TABLE IF NOT EXISTS email_events (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    outlook_message_id TEXT NOT NULL,
    internet_message_id TEXT,
    conversation_id TEXT,
    in_reply_to TEXT,
    "references" TEXT,
    association_confidence INTEGER NOT NULL DEFAULT 0,
    folder_name TEXT,
    event_type TEXT NOT NULL,
    sender TEXT,
    recipients TEXT,
    subject TEXT,
    summary TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    attachment_metadata TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`ALTER TABLE email_events ADD COLUMN IF NOT EXISTS internet_message_id TEXT`;
  await sql`ALTER TABLE email_events ADD COLUMN IF NOT EXISTS conversation_id TEXT`;
  await sql`ALTER TABLE email_events ADD COLUMN IF NOT EXISTS in_reply_to TEXT`;
  await sql`ALTER TABLE email_events ADD COLUMN IF NOT EXISTS "references" TEXT`;
  await sql`ALTER TABLE email_events ADD COLUMN IF NOT EXISTS association_confidence INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE email_events ADD COLUMN IF NOT EXISTS folder_name TEXT`;
  await sql`ALTER TABLE email_events DROP CONSTRAINT IF EXISTS email_events_outlook_message_id_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS email_events_rnc_message_unique ON email_events(rnc_id, outlook_message_id)`;
  await sql`CREATE INDEX IF NOT EXISTS email_events_rnc_occurred_idx ON email_events(rnc_id, occurred_at)`;
  await sql`CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    user_name TEXT NOT NULL DEFAULT 'Acesso direto',
    field TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE INDEX IF NOT EXISTS audit_rnc_idx ON audit_log(rnc_id)`;
  await sql`UPDATE rncs SET
    field_sources = '{"workId":"manual","description":"manual","type":"manual","notes":"manual","responseOwner":"manual","analysisOwner":"manual"}',
    manual_fields = '["workId","description","type","notes","responseOwner","analysisOwner"]'
    WHERE field_sources = '{}' AND id IN (SELECT rnc_id FROM audit_log WHERE field = 'registro')`;
  await sql`CREATE TABLE IF NOT EXISTS outlook_connections (
    id SERIAL PRIMARY KEY,
    account_email TEXT NOT NULL UNIQUE,
    encrypted_refresh_token TEXT NOT NULL,
    connected_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_sync_at TIMESTAMPTZ,
    last_sync_status TEXT,
    last_sync_message TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS outlook_sync_folders (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER NOT NULL REFERENCES outlook_connections(id),
    folder_id TEXT NOT NULL,
    folder_name TEXT NOT NULL,
    folder_kind TEXT NOT NULL,
    delta_link TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT outlook_sync_folder_unique UNIQUE(connection_id, folder_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sync_runs (
    id SERIAL PRIMARY KEY,
    connection_id INTEGER REFERENCES outlook_connections(id),
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    folders_checked TEXT NOT NULL DEFAULT '[]',
    imported_count INTEGER NOT NULL DEFAULT 0,
    message TEXT
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rnc_conflicts (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    field TEXT NOT NULL,
    candidate_values TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rnc_response_drafts (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    directive TEXT NOT NULL DEFAULT '',
    analysis TEXT NOT NULL DEFAULT '',
    actions_taken TEXT NOT NULL DEFAULT '',
    technical_response TEXT NOT NULL DEFAULT '',
    evidence TEXT NOT NULL DEFAULT '',
    conclusion TEXT NOT NULL DEFAULT '',
    agent_response TEXT NOT NULL DEFAULT '',
    email_body TEXT NOT NULL DEFAULT '',
    selected_attachments TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'Rascunho',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rnc_response_drafts_rnc_unique UNIQUE(rnc_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rnc_response_versions (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rnc_response_versions_number_unique UNIQUE(rnc_id, version)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS rnc_response_versions_rnc_idx ON rnc_response_versions(rnc_id)`;
  await sql`INSERT INTO works (name, active)
    VALUES ('Parque Socioambiental do Roger – Fase II', TRUE)
    ON CONFLICT (name) DO UPDATE SET active = TRUE`;
  await sql`UPDATE rncs
    SET work_id = (SELECT id FROM works WHERE name = 'Parque Socioambiental do Roger – Fase II')
    WHERE work_id IN (
      SELECT id FROM works
      WHERE name IN ('Parque do Roger - Fase II', 'Parque Socioambiental do Roger')
    )`;
  await sql`DELETE FROM rnc_conflicts WHERE rnc_id IN (
    SELECT r.id FROM rncs r JOIN works w ON w.id = r.work_id
    WHERE w.name <> 'Parque Socioambiental do Roger – Fase II'
  )`;
  await sql`DELETE FROM email_events WHERE rnc_id IN (
    SELECT r.id FROM rncs r JOIN works w ON w.id = r.work_id
    WHERE w.name <> 'Parque Socioambiental do Roger – Fase II'
  )`;
  await sql`DELETE FROM audit_log WHERE rnc_id IN (
    SELECT r.id FROM rncs r JOIN works w ON w.id = r.work_id
    WHERE w.name <> 'Parque Socioambiental do Roger – Fase II'
  )`;
  await sql`DELETE FROM rncs WHERE work_id IN (
    SELECT id FROM works WHERE name <> 'Parque Socioambiental do Roger – Fase II'
  )`;
  await sql`DELETE FROM works WHERE name <> 'Parque Socioambiental do Roger – Fase II'`;
}
