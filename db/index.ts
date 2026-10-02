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
    inspection_owner TEXT NOT NULL DEFAULT '',
    contract TEXT NOT NULL DEFAULT '',
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
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS inspection_owner TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS contract TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS inspection_date TEXT`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS issued_at TEXT`;
  await sql`ALTER TABLE rncs ADD COLUMN IF NOT EXISTS service_location TEXT NOT NULL DEFAULT ''`;
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
    updated_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rnc_response_drafts_rnc_unique UNIQUE(rnc_id)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS rnc_response_versions (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rnc_response_versions_number_unique UNIQUE(rnc_id, version)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS rnc_response_versions_rnc_idx ON rnc_response_versions(rnc_id)`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS updated_by TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS location_front TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS contract TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS observations TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS photo_legend_1 TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS photo_legend_2 TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS photo_legend_3 TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS photo_legend_4 TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS internal_comment TEXT NOT NULL DEFAULT ''`;
  await sql`ALTER TABLE rnc_response_versions ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT ''`;
  await sql`CREATE TABLE IF NOT EXISTS rnc_response_documents (
    id SERIAL PRIMARY KEY,
    rnc_id INTEGER NOT NULL REFERENCES rncs(id),
    version INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size INTEGER NOT NULL,
    content_base64 TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT rnc_response_documents_number_unique UNIQUE(rnc_id, version)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS rnc_response_documents_rnc_idx ON rnc_response_documents(rnc_id)`;
  await sql`CREATE TABLE IF NOT EXISTS app_migrations (
    key TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`WITH claimed AS (
      INSERT INTO app_migrations (key)
      VALUES ('2026-07-30-remove-test-word-documents-164-269')
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    )
    DELETE FROM rnc_response_documents
    WHERE EXISTS (SELECT 1 FROM claimed)
      AND rnc_id IN (
        SELECT id FROM rncs
        WHERE year = 2026 AND number IN ('164', '269')
      )`;
  // Tipos de resposta (TRATATIVA | PAM): aditivo; registros existentes viram TRATATIVA.
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'TRATATIVA'`;
  await sql`ALTER TABLE rnc_response_drafts ADD COLUMN IF NOT EXISTS form_data TEXT NOT NULL DEFAULT '{}'`;
  await sql`ALTER TABLE rnc_response_versions ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'TRATATIVA'`;
  await sql`ALTER TABLE rnc_response_versions ADD COLUMN IF NOT EXISTS response_sequence INTEGER NOT NULL DEFAULT 0`;
  await sql`ALTER TABLE rnc_response_documents ADD COLUMN IF NOT EXISTS response_type TEXT NOT NULL DEFAULT 'TRATATIVA'`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rnc_response_drafts_rnc_type_unique ON rnc_response_drafts(rnc_id, response_type)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rnc_response_versions_type_number_unique ON rnc_response_versions(rnc_id, response_type, version)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rnc_response_documents_type_number_unique ON rnc_response_documents(rnc_id, response_type, version)`;
  await sql`ALTER TABLE rnc_response_drafts DROP CONSTRAINT IF EXISTS rnc_response_drafts_rnc_unique`;
  await sql`ALTER TABLE rnc_response_versions DROP CONSTRAINT IF EXISTS rnc_response_versions_number_unique`;
  await sql`ALTER TABLE rnc_response_documents DROP CONSTRAINT IF EXISTS rnc_response_documents_number_unique`;
  await sql`WITH claimed AS (
    INSERT INTO app_migrations (key)
    VALUES ('2026-10-02-response-sequence-backfill')
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  )
  UPDATE rnc_response_versions SET response_sequence = version
  WHERE EXISTS (SELECT 1 FROM claimed) AND response_sequence = 0`;
  await sql`CREATE TABLE IF NOT EXISTS access_users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL,
    allowed_types TEXT NOT NULL DEFAULT '[]',
    allowed_works TEXT NOT NULL DEFAULT '[]',
    can_view_all BOOLEAN NOT NULL DEFAULT FALSE,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`;
  await sql`CREATE TABLE IF NOT EXISTS api_rate_limits (
    key TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL
  )`;
  await sql`ALTER TABLE access_users ADD COLUMN IF NOT EXISTS allowed_works TEXT NOT NULL DEFAULT '[]'`;
  await sql`ALTER TABLE works ADD COLUMN IF NOT EXISTS logo_url TEXT`;
  await sql`INSERT INTO access_users (name, email, role, allowed_types, allowed_works, can_view_all, active)
    VALUES
      ('Isabella Marques', 'isabella.marques@aahbrant.com', 'admin', '["*"]', '["*"]', TRUE, TRUE),
      ('Pedro Ferreira', 'pedro.ferreira@aahbrant.com', 'reviewer_approver', '["*"]', '["*"]', TRUE, TRUE),
      ('Rafaela Macedo', 'rafaela.macedo@aahbrant.com', 'reviewer_approver', '["*"]', '["*"]', TRUE, TRUE),
      ('Samuel Brumati', 'samuel.brumati@aahbrant.com', 'reviewer_approver', '["*"]', '["*"]', TRUE, TRUE),
      ('João Neto', 'joao.neto@aahbrant.com', 'reviewer_approver', '["*"]', '["*"]', TRUE, TRUE),
      ('José Bruno Gomes', 'jose.gomes@aahbrant.com', 'drafter', '["Segurança do Trabalho"]', '["*"]', FALSE, TRUE),
      ('Italo Monteiro', 'italo.monteiro@aahbrant.com', 'drafter', '["*"]', '["*"]', TRUE, TRUE)
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      role = EXCLUDED.role,
      allowed_types = EXCLUDED.allowed_types,
      can_view_all = EXCLUDED.can_view_all,
      active = TRUE,
      updated_at = CURRENT_TIMESTAMP`;
  await sql`WITH claimed AS (
    INSERT INTO app_migrations (key)
    VALUES ('2026-08-02-backfill-allowed-works-existing-users')
    ON CONFLICT (key) DO NOTHING
    RETURNING key
  )
  UPDATE access_users SET allowed_works = '["*"]'
  WHERE EXISTS (SELECT 1 FROM claimed)
    AND email IN (
      'isabella.marques@aahbrant.com',
      'pedro.ferreira@aahbrant.com',
      'rafaela.macedo@aahbrant.com',
      'samuel.brumati@aahbrant.com',
      'joao.neto@aahbrant.com',
      'jose.gomes@aahbrant.com',
      'italo.monteiro@aahbrant.com'
    )`;
  await sql`UPDATE rncs SET
      type = 'Execução',
      field_sources = jsonb_set(field_sources::jsonb, '{type}', '"Corrigido manualmente — falha construtiva"'::jsonb)::text,
      field_confidence = jsonb_set(field_confidence::jsonb, '{type}', '{"score":5,"reason":"Classificação confirmada como Execução para falha construtiva."}'::jsonb)::text,
      manual_fields = CASE
        WHEN manual_fields::jsonb ? 'type' THEN manual_fields
        ELSE (manual_fields::jsonb || '["type"]'::jsonb)::text
      END,
      updated_at = CURRENT_TIMESTAMP
    WHERE number IN ('268', '269') AND year = 2026`;
  await sql`INSERT INTO works (name, active)
    VALUES
      ('Parque Socioambiental do Roger – Fase II', TRUE),
      ('Compl. Beira Rio', TRUE)
    ON CONFLICT (name) DO UPDATE SET active = TRUE`;
  await sql`UPDATE rncs
    SET work_id = (SELECT id FROM works WHERE name = 'Parque Socioambiental do Roger – Fase II')
    WHERE work_id IN (
      SELECT id FROM works
      WHERE name IN ('Parque do Roger - Fase II', 'Parque Socioambiental do Roger')
    )`;
  await sql`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE key = '2026-08-02-configure-work-permissions-by-user') THEN
    UPDATE access_users SET allowed_works = jsonb_build_array(
      (SELECT id::text FROM works WHERE name = 'Parque Socioambiental do Roger – Fase II')
    )::text
    WHERE email IN ('pedro.ferreira@aahbrant.com', 'jose.gomes@aahbrant.com', 'italo.monteiro@aahbrant.com');

    UPDATE access_users SET allowed_works = '["*"]'
    WHERE email IN ('rafaela.macedo@aahbrant.com', 'samuel.brumati@aahbrant.com', 'joao.neto@aahbrant.com');

    INSERT INTO app_migrations (key) VALUES ('2026-08-02-configure-work-permissions-by-user');
  END IF;
END $$`;
}
