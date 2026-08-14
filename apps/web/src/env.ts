// wrangler の vars / .dev.vars は文字列しか運べないため、`wrangler types --strict-vars=false`
// が吐く Env では IDENTITY_PROVIDER は string になっている。実際に取りうる状態はこの 2 つだけ
// なので、ここで union に絞ってから Hono の Bindings に渡す。
//
// --strict-vars=true(既定)にすると wrangler.jsonc の値がそのままリテラル型になり、
// 「既定値と違う枝」が型上到達不能になって配線ミスに気づけなくなる。それを避けるための widen。
export type IdentityProvider = 'access' | 'static';

export type WorkerEnv = Readonly<Omit<Env, 'IDENTITY_PROVIDER'>> & {
  readonly IDENTITY_PROVIDER: IdentityProvider;
};
