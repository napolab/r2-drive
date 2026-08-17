import { DurableObject } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/durable-sqlite';

import { DDL } from './schema';

import type { DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite';

// 小さい土台。スキーマ適用と Drizzle インスタンスの保持だけを持つ。
// 機能は extends して足す(spec §5)。
//
// メソッドは必ず method shorthand で書くこと。arrow property は prototype ではなく
// インスタンスに乗るため RPC で公開されない。
export class SqliteStore extends DurableObject<Env> {
  protected readonly db: DrizzleSqliteDODatabase<Record<string, never>>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // durable-sqlite ドライバは同期方言('sync')であり、内部で ctx.storage.sql を
    // 直接叩く。だから transactionSync のクロージャの中でも使える(index.ts の upsert)。
    this.db = drizzle(ctx.storage);
    // 起動時に一度だけ DDL を流す。CREATE ... IF NOT EXISTS なので冪等。
    // sql.exec 自体は同期なので構造的には構築中に完了するが、blockConcurrencyWhile で
    // 囲うことで「スキーマ適用前のリクエストは入らない」を型ではなく実行順序として明示する。
    void ctx.blockConcurrencyWhile(async () => {
      for (const statement of DDL) ctx.storage.sql.exec(statement);
    });
  }
}
