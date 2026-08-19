import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useStableRows } from './index';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';

const createObject = (key: string, etag: string): ObjectDescriptor => ({
  bucketId: 'photos',
  key,
  name: key,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag,
});

const createFolder = (prefix: string): FolderDescriptor => ({
  bucketId: 'photos',
  prefix,
  name: prefix,
});

describe('useStableRows', () => {
  it('ページ追加で外側配列が新しくなっても既存 object の Row 参照を使い回す', () => {
    const a = createObject('a.txt', 'ea');
    const b = createObject('b.txt', 'eb');
    const c = createObject('c.txt', 'ec');

    const { result, rerender } = renderHook(
      ({ folders, objects }: { readonly folders: readonly FolderDescriptor[]; readonly objects: readonly ObjectDescriptor[] }) => useStableRows(folders, objects),
      {
        initialProps: { folders: [], objects: [a, b] },
      },
    );
    const [firstRowBefore, secondRowBefore] = result.current;

    // 新しい外側配列だが a, b は同じ参照(useInfiniteQuery の pages 追加を模す)
    rerender({ folders: [], objects: [a, b, c] });
    const [firstRowAfter, secondRowAfter, thirdRowAfter] = result.current;

    expect(firstRowAfter).toBe(firstRowBefore);
    expect(secondRowAfter).toBe(secondRowBefore);
    expect(thirdRowAfter).not.toBe(secondRowBefore);
    expect(thirdRowAfter?.kind).toBe('object');
  });

  it('ページ追加で folder 側も既存 Row 参照を使い回す', () => {
    const fa = createFolder('a/');
    const fb = createFolder('b/');
    const fc = createFolder('c/');

    const { result, rerender } = renderHook(
      ({ folders, objects }: { readonly folders: readonly FolderDescriptor[]; readonly objects: readonly ObjectDescriptor[] }) => useStableRows(folders, objects),
      {
        initialProps: { folders: [fa, fb], objects: [] },
      },
    );
    const [firstRowBefore, secondRowBefore] = result.current;

    rerender({ folders: [fa, fb, fc], objects: [] });
    const [firstRowAfter, secondRowAfter, thirdRowAfter] = result.current;

    expect(firstRowAfter).toBe(firstRowBefore);
    expect(secondRowAfter).toBe(secondRowBefore);
    expect(thirdRowAfter).not.toBe(secondRowBefore);
    expect(thirdRowAfter?.kind).toBe('folder');
  });

  it('同じ key でも中身の参照が変わったら Row を作り直す', () => {
    const a = createObject('a.txt', 'ea');

    const { result, rerender } = renderHook(
      ({ folders, objects }: { readonly folders: readonly FolderDescriptor[]; readonly objects: readonly ObjectDescriptor[] }) => useStableRows(folders, objects),
      {
        initialProps: { folders: [], objects: [a] },
      },
    );
    const [rowBefore] = result.current;

    const aWithNewEtag = createObject('a.txt', 'eb');
    rerender({ folders: [], objects: [aWithNewEtag] });
    const [rowAfter] = result.current;

    expect(rowAfter).not.toBe(rowBefore);
    expect(rowAfter?.kind).toBe('object');
    if (rowAfter?.kind !== 'object') throw new Error('row was not an object row');
    expect(rowAfter.object).toBe(aWithNewEtag);
  });

  it('folder を先、object を後の順で並べ、id は d: / f: 形式にする', () => {
    const folder = createFolder('docs/');
    const object = createObject('a.txt', 'ea');

    const { result } = renderHook(() => useStableRows([folder], [object]));

    expect(result.current.map((row) => row.kind)).toEqual(['folder', 'object']);
    expect(result.current.map((row) => row.id)).toEqual(['d:docs/', 'f:a.txt']);
  });

  it('消えたエントリはキャッシュに残らず、再登場時に新しい Row を作る', () => {
    const a = createObject('a.txt', 'ea');
    const b = createObject('b.txt', 'eb');

    const { result, rerender } = renderHook(
      ({ folders, objects }: { readonly folders: readonly FolderDescriptor[]; readonly objects: readonly ObjectDescriptor[] }) => useStableRows(folders, objects),
      {
        initialProps: { folders: [], objects: [a, b] },
      },
    );
    const bRowFirst = result.current.find((row) => row.id === 'f:b.txt');

    // b がフォルダ遷移などで一旦消える
    rerender({ folders: [], objects: [a] });

    // 同じ key の別参照(内容が同一でも新規オブジェクト)で b が再登場する
    const bAgain: ObjectDescriptor = { ...b };
    rerender({ folders: [], objects: [a, bAgain] });
    const bRowFinal = result.current.find((row) => row.id === 'f:b.txt');

    expect(bRowFinal).not.toBe(bRowFirst);
    expect(bRowFinal?.kind).toBe('object');
    if (bRowFinal?.kind !== 'object') throw new Error('row was not an object row');
    expect(bRowFinal.object).toBe(bAgain);
  });
});
