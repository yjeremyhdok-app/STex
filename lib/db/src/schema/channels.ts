import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const channelsTable = pgTable("channels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().default(""),
  apiUrl: text("api_url").notNull().default(""),
  method: text("method").notNull().default("GET"),
  headers: text("headers").notNull().default("{}"),
  notes: text("notes").notNull().default(""),

  // Auto-login fields
  loginUrl: text("login_url").notNull().default(""),
  loginBody: text("login_body").notNull().default("{}"),
  loginUsername: text("login_username").notNull().default(""),
  loginPassword: text("login_password").notNull().default(""),
  tokenPath: text("token_path").notNull().default(""),
  tokenType: text("token_type").notNull().default("bearer"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertChannelSchema = createInsertSchema(channelsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateChannelSchema = insertChannelSchema.partial();

export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type UpdateChannel = z.infer<typeof updateChannelSchema>;
export type Channel = typeof channelsTable.$inferSelect;
