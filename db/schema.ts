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
  responseType: text("response_type").notNull().default("TRATATIVA"),
  formData: text("form_data").notNull().default("{}"),
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
  uniqueIndex("rnc_response_drafts_rnc_type_unique").on(table.rncId, table.responseType),
]);

export const rncResponseVersions = pgTable("rnc_response_versions", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  responseType: text("response_type").notNull().default("TRATATIVA"),
  responseSequence: integer("response_sequence").notNull().default(0),
  version: integer("version").notNull(),
  snapshot: text("snapshot").notNull(),
  createdBy: text("created_by").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rnc_response_versions_type_number_unique").on(table.rncId, table.responseType, table.version),
  index("rnc_response_versions_rnc_idx").on(table.rncId),
]);

export const rncResponseDocuments = pgTable("rnc_response_documents", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  responseType: text("response_type").notNull().default("TRATATIVA"),
  version: integer("version").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  contentBase64: text("content_base64").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("rnc_response_documents_type_number_unique").on(table.rncId, table.responseType, table.version),
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

// Planner de prazos: cada versão de PAM analisada vira um registro, e cada prazo/etapa identificado vira um compromisso.
export const plannerPams = pgTable("planner_pams", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  // Nulo quando o PAM veio como anexo de e-mail (FG 06 elaborado fora do sistema).
  responseVersionId: integer("response_version_id").references(() => rncResponseVersions.id),
  source: text("source").notNull().default("SISTEMA"),
  emailEventId: integer("email_event_id"),
  attachmentId: text("attachment_id"),
  attachmentName: text("attachment_name"),
  documentDate: text("document_date"),
  pamVersion: integer("pam_version").notNull(),
  sentAt: text("sent_at"),
  sentSource: text("sent_source"),
  sentEventId: integer("sent_event_id"),
  sentAdjustedBy: text("sent_adjusted_by"),
  sentAdjustReason: text("sent_adjust_reason"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "string" }),
  confirmedBy: text("confirmed_by"),
  status: text("status").notNull().default("ATIVO"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("planner_pams_version_unique").on(table.responseVersionId),
  uniqueIndex("planner_pams_email_unique").on(table.emailEventId, table.attachmentName),
  index("planner_pams_rnc_idx").on(table.rncId),
]);

export const plannerCommitments = pgTable("planner_commitments", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  plannerPamId: integer("planner_pam_id").notNull().references(() => plannerPams.id),
  pamVersion: integer("pam_version").notNull(),
  orderIndex: integer("order_index").notNull().default(0),
  kind: text("kind").notNull().default("ETAPA"),
  source: text("source").notNull().default("PROPOSTA"),
  title: text("title").notNull(),
  originalText: text("original_text").notNull().default(""),
  quantity: integer("quantity"),
  unit: text("unit").notNull().default("CORRIDOS"),
  baseType: text("base_type").notNull().default("PAM_SENT_DATE"),
  fixedDate: text("fixed_date"),
  milestoneLabel: text("milestone_label"),
  milestoneDate: text("milestone_date"),
  predecessorId: integer("predecessor_id"),
  extracted: text("extracted").notNull().default("{}"),
  needsReview: boolean("needs_review").notNull().default(false),
  reviewReason: text("review_reason"),
  baseDate: text("base_date"),
  calculatedDue: text("calculated_due"),
  originalDue: text("original_due"),
  currentDue: text("current_due"),
  isProjected: boolean("is_projected").notNull().default(false),
  state: text("state").notNull().default("OK"),
  manualAdjust: boolean("manual_adjust").notNull().default(false),
  adjustedDue: text("adjusted_due"),
  adjustedBy: text("adjusted_by"),
  adjustedAt: timestamp("adjusted_at", { withTimezone: true, mode: "string" }),
  adjustReason: text("adjust_reason"),
  status: text("status").notNull().default("PENDENTE"),
  completedAt: text("completed_at"),
  completedBy: text("completed_by"),
  completedRegisteredAt: timestamp("completed_registered_at", { withTimezone: true, mode: "string" }),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [
  index("planner_commitments_rnc_idx").on(table.rncId),
  index("planner_commitments_pam_idx").on(table.plannerPamId),
  index("planner_commitments_due_idx").on(table.currentDue),
]);

export const plannerSettings = pgTable("planner_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const rncComments = pgTable("rnc_comments", {
  rncId: integer("rnc_id").primaryKey().references(() => rncs.id),
  comment: text("comment").notNull().default(""),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
