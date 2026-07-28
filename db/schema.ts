import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const works = sqliteTable("works", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const rncs = sqliteTable("rncs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  workId: integer("work_id").notNull().references(() => works.id),
  number: text("number").notNull(),
  year: integer("year").notNull(),
  description: text("description").notNull().default("Descrição não identificada"),
  type: text("type").notNull().default("A classificar"),
  receivedAt: text("received_at").notNull(),
  dueAt: text("due_at").notNull(),
  sentAt: text("sent_at"),
  returnedAt: text("returned_at"),
  status: text("status").notNull().default("Recebida"),
  notes: text("notes").notNull().default(""),
  responseOwner: text("response_owner").notNull().default(""),
  analysisOwner: text("analysis_owner").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("rncs_work_number_year_unique").on(table.workId, table.number, table.year),
  index("rncs_status_idx").on(table.status),
  index("rncs_due_at_idx").on(table.dueAt),
]);

export const emailEvents = sqliteTable("email_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  outlookMessageId: text("outlook_message_id").unique(),
  eventType: text("event_type").notNull(),
  sender: text("sender"),
  recipients: text("recipients"),
  subject: text("subject"),
  summary: text("summary"),
  occurredAt: text("occurred_at").notNull(),
  attachmentMetadata: text("attachment_metadata"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  userName: text("user_name").notNull().default("Acesso direto"),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedAt: text("changed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_rnc_idx").on(table.rncId)]);
