import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const works = pgTable("works", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const rncs = pgTable("rncs", {
  id: serial("id").primaryKey(),
  workId: integer("work_id").notNull().references(() => works.id),
  number: text("number").notNull(),
  year: integer("year").notNull(),
  description: text("description").notNull().default("Descrição não identificada"),
  type: text("type").notNull().default("A classificar"),
  receivedAt: text("received_at"),
  dueAt: text("due_at"),
  sentAt: text("sent_at"),
  returnedAt: text("returned_at"),
  inspectionDate: text("inspection_date"),
  issuedAt: text("issued_at"),
  serviceLocation: text("service_location").notNull().default(""),
  status: text("status").notNull().default("Recebida"),
  notes: text("notes").notNull().default(""),
  responseOwner: text("response_owner").notNull().default(""),
  inspectionOwner: text("inspection_owner").notNull().default(""),
  contract: text("contract").notNull().default(""),
  analysisOwner: text("analysis_owner").notNull().default(""),
  fieldSources: text("field_sources").notNull().default("{}"),
  fieldConfidence: text("field_confidence").notNull().default("{}"),
  manualFields: text("manual_fields").notNull().default("[]"),
  sourceSummary: text("source_summary").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rncs_work_number_year_unique").on(table.workId, table.number, table.year),
  index("rncs_status_idx").on(table.status),
  index("rncs_due_at_idx").on(table.dueAt),
]);

export const emailEvents = pgTable("email_events", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  outlookMessageId: text("outlook_message_id").notNull(),
  internetMessageId: text("internet_message_id"),
  conversationId: text("conversation_id"),
  inReplyTo: text("in_reply_to"),
  references: text("references"),
  associationConfidence: integer("association_confidence").notNull().default(0),
  folderName: text("folder_name"),
  eventType: text("event_type").notNull(),
  sender: text("sender"),
  recipients: text("recipients"),
  subject: text("subject"),
  summary: text("summary"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  attachmentMetadata: text("attachment_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("email_events_rnc_message_unique").on(table.rncId, table.outlookMessageId),
  index("email_events_rnc_occurred_idx").on(table.rncId, table.occurredAt),
]);

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  userName: text("user_name").notNull().default("Acesso direto"),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("audit_rnc_idx").on(table.rncId)]);

export const outlookConnections = pgTable("outlook_connections", {
  id: serial("id").primaryKey(),
  accountEmail: text("account_email").notNull().unique(),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true, mode: "string" }),
  lastSyncStatus: text("last_sync_status"),
  lastSyncMessage: text("last_sync_message"),
});

export const outlookSyncFolders = pgTable("outlook_sync_folders", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").notNull().references(() => outlookConnections.id),
  folderId: text("folder_id").notNull(),
  folderName: text("folder_name").notNull(),
  folderKind: text("folder_kind").notNull(),
  deltaLink: text("delta_link"),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("outlook_sync_folder_unique").on(table.connectionId, table.folderId),
]);

export const syncRuns = pgTable("sync_runs", {
  id: serial("id").primaryKey(),
  connectionId: integer("connection_id").references(() => outlookConnections.id),
  startedAt: timestamp("started_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true, mode: "string" }),
  status: text("status").notNull().default("running"),
  foldersChecked: text("folders_checked").notNull().default("[]"),
  importedCount: integer("imported_count").notNull().default(0),
  message: text("message"),
});

export const rncConflicts = pgTable("rnc_conflicts", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  field: text("field").notNull(),
  candidateValues: text("candidate_values").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "string" }),
});

export const rncResponseDrafts = pgTable("rnc_response_drafts", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  directive: text("directive").notNull().default(""),
  analysis: text("analysis").notNull().default(""),
  actionsTaken: text("actions_taken").notNull().default(""),
  technicalResponse: text("technical_response").notNull().default(""),
  evidence: text("evidence").notNull().default(""),
  conclusion: text("conclusion").notNull().default(""),
  agentResponse: text("agent_response").notNull().default(""),
  emailBody: text("email_body").notNull().default(""),
  locationFront: text("location_front").notNull().default(""),
  contract: text("contract").notNull().default(""),
  observations: text("observations").notNull().default(""),
  photoLegend1: text("photo_legend_1").notNull().default(""),
  photoLegend2: text("photo_legend_2").notNull().default(""),
  photoLegend3: text("photo_legend_3").notNull().default(""),
  photoLegend4: text("photo_legend_4").notNull().default(""),
  internalComment: text("internal_comment").notNull().default(""),
  selectedAttachments: text("selected_attachments").notNull().default("[]"),
  status: text("status").notNull().default("Rascunho"),
  updatedBy: text("updated_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rnc_response_drafts_rnc_unique").on(table.rncId),
]);

export const rncResponseVersions = pgTable("rnc_response_versions", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  version: integer("version").notNull(),
  snapshot: text("snapshot").notNull(),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rnc_response_versions_number_unique").on(table.rncId, table.version),
  index("rnc_response_versions_rnc_idx").on(table.rncId),
]);

export const rncResponseDocuments = pgTable("rnc_response_documents", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  version: integer("version").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  contentBase64: text("content_base64").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rnc_response_documents_number_unique").on(table.rncId, table.version),
  index("rnc_response_documents_rnc_idx").on(table.rncId),
]);

export const accessUsers = pgTable("access_users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").notNull(),
  allowedTypes: text("allowed_types").notNull().default("[]"),
  allowedWorks: text("allowed_works").notNull().default("[]"),
  canViewAll: boolean("can_view_all").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("access_users_email_unique").on(table.email),
]);

export const apiRateLimits = pgTable("api_rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(1),
  windowStart: timestamp("window_start", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
});
