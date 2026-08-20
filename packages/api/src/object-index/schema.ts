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
    // 画像でなければ、あるいはまだ寸法を知らなければ NULL のまま(NOT NULL を付けない)。
    // list()/search() は mediaOf(row.width, row.height) を通して MediaFacts に変換する
    // (Task 1 の mediaOf が null/undefined/非正数を variant:'none' に落とす)。
    width: integer('width'),
    height: integer('height'),
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
     etag TEXT NOT NULL,
     width INTEGER,
     height INTEGER
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

// 既存 DO への後付け列。SQLite に ADD COLUMN IF NOT EXISTS は無いので、
// 適用側(SqliteStore)が PRAGMA table_info で列の有無を見てから流す。
// 新規 DO は上の DDL の CREATE TABLE に width/height が既に含まれているので、
// このリストは「Task 2 より前に作られた DO」を追いつかせるためだけに存在する。
export const OBJECTS_MEDIA_COLUMNS: readonly { readonly name: string; readonly ddl: string }[] = [
  { name: 'width', ddl: `ALTER TABLE objects ADD COLUMN width INTEGER` },
  { name: 'height', ddl: `ALTER TABLE objects ADD COLUMN height INTEGER` },
];
