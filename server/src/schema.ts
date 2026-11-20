// Drizzle schema for this space.
//
// One table: the chat history between the user and おちゃ (Muse),
// stored in chronological order. The scaffold `entries` table is dropped
// by the migration that creates this one.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
