import { err } from 'neverthrow';

import type { Result } from 'neverthrow';

// 全拡張点が共有する唯一のディスパッチ実装。
// 新しいディスパッチ形(Map<k, fn> / switch / スコア方式)を発明しないこと。
export interface Processor<I, O> {
  readonly id: string;
  run(input: I): Result<O, I>;
}

const step = <I, O>(input: I, plugins: readonly Processor<I, O>[]): Result<O, I> => {
  const [head, ...tail] = plugins;
  if (head === undefined) return err(input);
  const result = head.run(input);
  if (result.isOk()) return result;

  return step(input, tail);
};

export const createRunner =
  <I, O>(plugins: readonly Processor<I, O>[]) =>
  (input: I): Result<O, I> =>
    step(input, plugins);
