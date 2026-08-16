import { err, ok } from 'neverthrow';
import { describe, expect, it } from 'vitest';

import { createRunner } from './create-runner';

import type { Processor } from './create-runner';

const upper: Processor<string, string> = {
  id: 'upper',
  run: (input) => (input.startsWith('u:') ? ok(input.slice(2).toUpperCase()) : err(input)),
};

const echo: Processor<string, string> = {
  id: 'echo',
  run: (input) => ok(input),
};

describe('createRunner', () => {
  it('最初に ok を返したプラグインの結果を採用する', () => {
    const run = createRunner([upper, echo]);

    expect(run('u:abc')).toEqual(ok('ABC'));
  });

  it('マッチしないプラグインを飛ばして後続に渡す', () => {
    const run = createRunner([upper, echo]);

    expect(run('plain')).toEqual(ok('plain'));
  });

  it('順序が意味を持つ — 先に置いた広いプラグインが後続を隠す', () => {
    const run = createRunner([echo, upper]);

    expect(run('u:abc')).toEqual(ok('u:abc'));
  });

  it('誰もマッチしなければ入力を err で返す', () => {
    const run = createRunner<string, string>([upper]);

    expect(run('plain')).toEqual(err('plain'));
  });

  it('プラグインが空でも入力を err で返す', () => {
    const run = createRunner<string, string>([]);

    expect(run('x')).toEqual(err('x'));
  });
});
