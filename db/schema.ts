import { boolean, index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const works = pgTable("works", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const rncs = pgTable("rncs", {
  id: serial("id").primaryKey(),
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
  outlookMessageId: text("outlook_message_id").unique(),
  eventType: text("event_type").notNull(),
  sender: text("sender"),
  recipients: text("recipients"),
  subject: text("subject"),
  summary: text("summary"),
  occurredAt: timestamp("occurred_at", { withTimezone: true, mode: "string" }).notNull(),
  attachmentMetadata: text("attachment_metadata"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: serial("id").primaryKey(),
  rncId: integer("rnc_id").notNull().references(() => rncs.id),
  userName: text("user_name").notNull().default("Acesso direto"),
  field: text("field").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedAt: timestamp("changed_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
}, (table) => [index("audit_rnc_idx").on(table.rncId)]);
