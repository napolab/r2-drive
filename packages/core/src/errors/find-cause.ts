type ErrorPredicate<T extends Error> = (value: unknown) => value is T;

export const isInstanceOf =
  <T extends Error>(ctor: abstract new (...args: never[]) => T): ErrorPredicate<T> =>
  (value): value is T =>
    value instanceof ctor;

// cause チェーンを根に向かって辿り、最初に一致したものを返す。
// 一致した時点で返るのでチェーンを最後まで歩かない。
// depth は暴走よけ。Error.cause に循環は作れないが、第三者の値が混ざる可能性はある。
export const findCause = <T extends Error>(value: unknown, matches: ErrorPredicate<T>, depth = 32): T | undefined => {
  if (matches(value)) return value;
  if (depth <= 0) return undefined;
  if (!(value instanceof Error)) return undefined;
  if (value.cause === undefined) return undefined;

  return findCause(value.cause, matches, depth - 1);
};

// ログ用。こちらは全走査する。
export const describeCauseChain = (value: unknown, depth = 32): readonly string[] => {
  if (!(value instanceof Error) || depth <= 0) return [String(value)];

  return [`${value.name}: ${value.message}`, ...describeCauseChain(value.cause, depth - 1)];
};
