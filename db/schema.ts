import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
export const records = sqliteTable('records', {id:text('id').primaryKey(),kind:text('kind').notNull(),payload:text('payload').notNull(),updatedAt:text('updated_at').notNull()}, t=>[index('idx_records_kind_updated').on(t.kind,t.updatedAt)]);
