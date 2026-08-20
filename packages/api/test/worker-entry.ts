import { count as countRows, eq } from 'drizzle-orm';

import { api } from '../src/index';
import { ObjectIndex } from '../src/object-index/index';
import { backfillTombstones, meta, objects, prefixes } from '../src/object-index/schema';

import type { ObjectDescriptor } from '@r2-drive/core';

type ObjectRow = typeof objects.$inferSelect;
type PrefixRow = typeof prefixes.$inferSelect;

// I3 の競合窓をテストから決定的に作るための仕込み。listBackfillPage override が
// atCall 回目の list 直後・適用前にちょうど 1 回だけ実行する。structured clone を
// 越えて RPC 引数として渡すため、関数ではなくデータ(discriminated union)で表す。
// atCall はページ番号(1 始まり)。複数ページに跨るバックフィルで「2 ページ目の
// スナップショットを取った直後」のような、1 ページ目より後の窓を再現するために要る。
type BackfillRace =
  | { readonly kind: 'none' }
  | { readonly kind: 'remove'; readonly key: string; readonly atCall: number }
  | { readonly kind: 'upsert'; readonly descriptor: ObjectDescriptor; readonly atCall: number };

// テスト専用の DO クラス。production の ObjectIndex に置いてよいのは upsert / remove /
// count だけで、覗き見用のメソッドや DO SQLite の性質を測る probe を本番の RPC 表面に
// 常設しない(Ruling 10)。vitest.config.ts の durableObjects.className はこの
// クラスを指している。
//
// SqliteStore → ObjectIndex → ObjectIndexUnderTest の 3 段継承が RPC で正しく公開される
// ことは、このクラス経由で upsert / count を呼ぶテストが通ること自体が実証している
// (RPC は prototype chain を辿るので継承メソッドも公開される)。
//
// メソッドは必ず method shorthand で書くこと。arrow property は prototype ではなく
// インスタンスに乗るため RPC で公開されない。
export class ObjectIndexUnderTest extends ObjectIndex {
  #backfillRace: BackfillRace = { kind: 'none' };
  #listBackfillPageCalls = 0;

  // atCall 回目の listBackfillPage 呼び出しに 1 回だけ効く割り込みを仕込む。
  setBackfillRace(race: BackfillRace): void {
    this.#backfillRace = race;
  }

  // listBackfillPage が実際に呼ばれた回数。「複数ページに跨るバックフィルで、狙った
  // ページ(2 ページ目以降)まで実際に到達したか」をテストから確認するための窓
  // (atCall を仕込んだのに 1 ページで終わっていたら、そのテストは何も検証していない)。
  debugBackfillPageCalls(): number {
    return this.#listBackfillPageCalls;
  }

  // I3 の窓の再現: 実際の list を取った直後、そのページを索引に適用する前に、仕込んだ
  // 割り込み(remove / upsert)を挟む。atCall 回目の呼び出しでだけ発火し、使ったら
  // 'none' に戻すので 1 回しか効かない。1 ページ目だけでなく任意のページ番号を狙える
  // ようにしているのは、複数ページに跨るバックフィルでも「N ページ目のスナップ
  // ショットを取った直後」の窓を決定的に再現するため。
  override async listBackfillPage(bucket: R2Bucket, cursor: string | undefined): Promise<R2Objects> {
    const listed = await super.listBackfillPage(bucket, cursor);
    this.#listBackfillPageCalls += 1;

    const race = this.#backfillRace;
    if (race.kind === 'none' || race.atCall !== this.#listBackfillPageCalls) return listed;

    this.#backfillRace = { kind: 'none' };
    switch (race.kind) {
      case 'remove':
        await bucket.delete(race.key);
        this.remove(race.key);
        break;
      case 'upsert':
        this.upsert(race.descriptor);
        break;
    }

    return listed;
  }

  debugRow(key: string): ObjectRow | undefined {
    return this.db.select().from(objects).where(eq(objects.key, key)).get();
  }

  // backfill_tombstones の行数。I3 のトゥームストーンが「走行中だけ書かれ、終端で
  // クリアされる」ことを覗くための窓。
  debugTombstoneCount(): number {
    const row = this.db.select({ total: countRows() }).from(backfillTombstones).get();

    return row?.total ?? 0;
  }

  // parent_prefix も返す。prefix 列だけを返していたため「prefixes.parent_prefix を
  // 'MUTANT' に固定してもテストが全部通る」という穴が空いていた。Task 5 の一覧は
  // この列で親を引くので、ここで検算できる形にしておく。
  debugPrefixes(): readonly PrefixRow[] {
    return this.db.select().from(prefixes).orderBy(prefixes.prefix).all();
  }

  // meta 表を覗く窓。bucket_id(Ruling 11 の誤ルーティング検出)とバックフィルの
  // backfill_* が同居する表なので、「バックフィルが bucket_id を巻き添えに消していないか」
  // を直接見るために使う。
  debugMeta(k: string): string | undefined {
    return this.db.select({ v: meta.v }).from(meta).where(eq(meta.k, k)).get()?.v ?? undefined;
  }

  // 予約済み alarm の時刻。未予約なら null。「回復不能な失敗は状態に記録して止める」の
  // 「止める」側 — つまり次の alarm を予約していないこと — を実際に張るための窓。
  // これが無いと「failed になる」しか検証できず、テスト名が主張する「再予約しない」が
  // 空手形になる。
  async debugAlarm(): Promise<number | null> {
    return this.ctx.storage.getAlarm();
  }

  // FTS5 の仮想テーブルは Drizzle で表現できないので raw SQL で覗く。
  // 「upsert したら引ける / remove したら引けない」を張るための読み取り専用の窓。
  debugFtsKeys(): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ key: string }>(`SELECT key FROM objects_fts ORDER BY key`)
      .toArray()
      .map((row) => row.key);
  }

  // 名前で MATCH できることまで見る(FTS5 に key/name を入れている意味の確認)。
  debugFtsSearch(query: string): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ key: string }>(`SELECT key FROM objects_fts WHERE objects_fts MATCH ? ORDER BY rank`, query)
      .toArray()
      .map((row) => row.key);
  }

  // 実際に適用された DDL を PRAGMA で読み返す窓。schema.ts の Drizzle 定義と
  // 手書き DDL のドリフト検出に使う(Ruling 12)。table 名は ? で束縛できるので
  // 文字列連結はしない。
  debugTableColumns(table: string): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_table_info(?)`, table)
      .toArray()
      .map((row) => row.name);
  }

  debugTableIndexes(table: string): readonly string[] {
    return this.ctx.storage.sql
      .exec<{ name: string }>(`SELECT name FROM pragma_index_list(?)`, table)
      .toArray()
      .map((row) => row.name);
  }

  // 以下 4 つは Task 1 / 2 が DO SQLite の性質を実測で固定するための probe。
  // 実装の一部ではないが、この 2 つの事実(FTS5 が使える / 連続 sql.exec は原子的でない)
  // の上に upsert の設計が乗っているので、回帰検出のために残している。
  debugProbeFts(): readonly string[] {
    this.ctx.storage.sql.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS probe_fts USING fts5(name)`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, '休暇の写真 vacation-2026.jpg');
    this.ctx.storage.sql.exec(`INSERT INTO probe_fts (name) VALUES (?)`, 'invoice-2026-04.pdf');

    const rows = this.ctx.storage.sql.exec<{ name: string }>(`SELECT name FROM probe_fts WHERE probe_fts MATCH ? ORDER BY rank`, 'vacation').toArray();

    return rows.map((row) => row.name);
  }

  // 測定対象(debugProbeAtomicityWith*)とは別の RPC 呼び出しに出すセットアップ。
  // CREATE / DELETE / seed をここで確実に完了させ、await 境界を挟むことで、
  // 測定対象の 2 文が「たまたま CREATE ごと巻き戻った」結果を原子性の証拠と
  // 誤読しないようにする。'seed' は 2 回目の INSERT で意図的に再利用し、
  // 実行時の UNIQUE 制約違反を起こすために残す。
  debugSetupAtomicityProbe(): void {
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS probe_a (k TEXT PRIMARY KEY)`);
    this.ctx.storage.sql.exec(`DELETE FROM probe_a`);
    this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
  }

  // debugSetupAtomicityProbe() の後に呼ぶこと。'first' の INSERT は成功し、
  // 'seed' の再 INSERT は主キー重複で実行時に確実に失敗する(prepare 段階では
  // 落ちない)。束ねられて原子的なら 'first' も巻き戻り行数は 1(seed のみ)、
  // 束ねられないなら 'first' が残り行数は 2 になる。
  debugProbeAtomicityWithoutTransaction(): number {
    try {
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
      // 主キー重複による UNIQUE 制約違反。実行時に確実に失敗する。
      this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
    } catch {
      // 例外は握る。ここで見たいのは probe_a の中身だけ。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }

  // debugProbeAtomicityWithoutTransaction() の対照実験。同じ 2 文を
  // this.ctx.storage.transactionSync() で明示的に囲う。巻き戻り機構自体が
  // この環境で動くことを示すための positive control。
  debugProbeAtomicityWithTransactionSync(): number {
    try {
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'first');
        // 主キー重複による UNIQUE 制約違反。実行時に確実に失敗する。
        this.ctx.storage.sql.exec(`INSERT INTO probe_a (k) VALUES (?)`, 'seed');
      });
    } catch {
      // transactionSync はロールバック後に元の例外を再送出する。ここで見たいのは
      // probe_a の中身だけなので握る。
    }

    return this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM probe_a`).one().n;
  }
}

export default api;
