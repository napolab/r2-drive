import { expect, it } from 'vitest';

import { objectIndexNamespace } from './object-index-namespace';

// spec §12 のリスク 1。Cloudflare は対応拡張の一覧を D1 と DO で共有して記述しているが、
// DO で明示的に検証した記述は確認できていない。ここで実測して固定する。
it('DO の SQLite で FTS5 の仮想テーブルが作れて MATCH が引ける', async () => {
  const stub = objectIndexNamespace.get(objectIndexNamespace.idFromName('fts-probe'));

  await expect(stub.probeFts()).resolves.toEqual(['休暇の写真 vacation-2026.jpg']);
});
