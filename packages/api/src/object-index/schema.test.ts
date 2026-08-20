import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';

import { objectIndexNamespace } from '../../test/object-index-namespace';
import { meta, objects, prefixes } from './schema';

import type { SQLiteTable } from 'drizzle-orm/sqlite-core';

// schema.ts は同じスキーマを 2 回書いている: Drizzle の sqliteTable 定義(クエリが使う)と
// 手書きの DDL 配列(実際に DB に適用される)。この 2 つがずれると、列の欠落は運良く
// 落ちるかもしれないが、index の欠落・列順違いは何も落ちない。index の欠落は
// 10,000 件の性能要件に直結する。
//
// .claude/rules/cross-module-sync-test.md の要求どおり、コメントで「同期させること」と
// 書く代わりに両方を import して等価を assert する。片方 = Drizzle 定義、
// もう片方 = DO に実際に適用された DDL を PRAGMA で読み返した結果。
const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('schema-drift'));

// SQLite が主キーのために自動生成する index は DDL にも Drizzle 定義にも現れない。
const userIndexesOf = (names: readonly string[]): readonly string[] => names.filter((name) => !name.startsWith('sqlite_')).toSorted();

const tables: readonly SQLiteTable[] = [objects, prefixes, meta];

describe('schema.ts の Drizzle 定義と適用済み DDL が一致する', () => {
  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))('%s の列名と列順が一致する', async (_name, table) => {
    const config = getTableConfig(table);

    await expect(stub.debugTableColumns(config.name)).resolves.toEqual(config.columns.map((column) => column.name));
  });

  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))('%s の index が一致する', async (_name, table) => {
    const config = getTableConfig(table);

    await expect(stub.debugTableIndexes(config.name).then(userIndexesOf)).resolves.toEqual(config.indexes.map((index) => index.config.name).toSorted());
  });

  // 上の 2 本が「両方とも空」で通ってしまわないための positive control。
  // PRAGMA が読めていない / テーブル名が間違っているときにここが落ちる。
  it('Drizzle 定義側が空でないことを確かめる', () => {
    expect(getTableConfig(objects).columns.map((column) => column.name)).toEqual(['key', 'name', 'parent_prefix', 'content_type', 'size', 'uploaded_at', 'etag', 'width', 'height']);
    expect(getTableConfig(objects).indexes.map((index) => index.config.name)).toEqual(['objects_by_folder']);
    expect(getTableConfig(prefixes).indexes.map((index) => index.config.name)).toEqual(['prefixes_by_parent']);
  });

  // objects_fts は FTS5 の仮想テーブルなので Drizzle 定義を持たない。
  // DDL 側にだけ存在することを直接確かめる。
  it('objects_fts は DDL 側に存在する', async () => {
    await expect(stub.debugTableColumns('objects_fts')).resolves.toEqual(['key', 'name']);
  });
});
