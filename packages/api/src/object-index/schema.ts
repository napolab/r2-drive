import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// 1 バケット = 1 DO なので bucket_id 列を持たない。
export const objects = sqliteTable(
  'objects',
  {
    key: text('key').primaryKey(),
    name: text('name').notNull(),
    parentPrefix: text('parent_prefix').notNull(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    uploadedAt: text('uploaded_at').notNull(),
    etag: text('etag').notNull(),
  },
  (table) => [index('objects_by_folder').on(table.parentPrefix, table.key)],
);

export const prefixes = sqliteTable(
  'prefixes',
  {
    prefix: text('prefix').primaryKey(),
    parentPrefix: text('parent_prefix').notNull(),
  },
  (table) => [index('prefixes_by_parent').on(table.parentPrefix)],
);

export const meta = sqliteTable('meta', {
  k: text('k').primaryKey(),
  v: text('v'),
});

// バックフィルの実行中(meta.backfill_state === 'running')に remove() されたキーを
// 記録する。#indexPage のスナップショットはこのテーブルに残るキーをゴースト行として
// スキップする(I3)。meta と違い bucket_id を同居させていないので、走行の開始 / 終端で
// 一括クリアしてよい(index.ts の startBackfill / 完了・失敗時の掃除)。
export const backfillTombstones = sqliteTable('backfill_tombstones', {
  key: text('key').primaryKey(),
});

// drizzle-kit を入れない方針なので DDL は手書きする(計画の Global Constraints)。
// objects_fts は FTS5 の仮想テーブルであり Drizzle では表現できないため、
// 読み書きとも raw SQL で扱う。
export const DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS objects (
     key TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     parent_prefix TEXT NOT NULL,
     content_type TEXT NOT NULL,
     size INTEGER NOT NULL,
     uploaded_at TEXT NOT NULL,
     etag TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS objects_by_folder ON objects (parent_prefix, key)`,
  `CREATE TABLE IF NOT EXISTS prefixes (
     prefix TEXT PRIMARY KEY,
     parent_prefix TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS prefixes_by_parent ON prefixes (parent_prefix)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS objects_fts USING fts5(key, name)`,
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)`,
  `CREATE TABLE IF NOT EXISTS backfill_tombstones (key TEXT PRIMARY KEY)`,
];
