import { describe, expect, it } from 'vitest';

import { getContextSelection, removeObjectsFromPages, resolveSelectedRows } from './model';
import { getFolderRowId, getObjectRowId } from '../object-list/row-id';

import type { FolderDescriptor, ObjectDescriptor, ObjectPage } from '@r2-drive/core';
import type { InfiniteData } from '@tanstack/react-query';

const folders: readonly FolderDescriptor[] = [{ bucketId: 'photos', prefix: 'docs/', name: 'docs' }];
const objects: readonly ObjectDescriptor[] = ['a.txt', 'b.txt', 'c.txt'].map((key) => ({
  bucketId: 'photos',
  key,
  name: key,
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: key,
}));
const [firstObject, secondObject] = objects;
const [firstFolder] = folders;
if (firstObject === undefined || secondObject === undefined || firstFolder === undefined) throw new Error('row fixtures were not created');

describe('resolveSelectedRows', () => {
  it('row id map から file-only selection を順に解決する', () => {
    expect(resolveSelectedRows(new Set([getObjectRowId(firstObject), getObjectRowId(secondObject)]), folders, objects)).toEqual({ kind: 'files', objects: [firstObject, secondObject] });
  });

  it('folder-only と mixed selection を同じ unsupported variant にする', () => {
    expect(resolveSelectedRows(new Set([getFolderRowId(firstFolder)]), folders, objects)).toEqual({ kind: 'contains-folders' });
    expect(resolveSelectedRows(new Set([getFolderRowId(firstFolder), getObjectRowId(firstObject)]), folders, objects)).toEqual({ kind: 'contains-folders' });
    expect(resolveSelectedRows('all', folders, objects)).toEqual({ kind: 'contains-folders' });
  });

  it('空 selection は empty にする', () => {
    expect(resolveSelectedRows(new Set(), folders, objects)).toEqual({ kind: 'empty' });
  });
});

describe('getContextSelection', () => {
  it('対象を含む file-only multi selection を維持する', () => {
    const current = new Set([getObjectRowId(firstObject), getObjectRowId(secondObject)]);

    expect(getContextSelection(current, secondObject, folders, objects)).toEqual({ selectedKeys: current, objects: [firstObject, secondObject] });
  });

  it('未選択対象または folder 混在なら対象 file だけへ置き換える', () => {
    const unselected = getContextSelection(new Set([getObjectRowId(firstObject)]), secondObject, folders, objects);
    expect([...unselected.selectedKeys]).toEqual([getObjectRowId(secondObject)]);
    expect(unselected.objects).toEqual([secondObject]);

    const mixed = getContextSelection(new Set([getFolderRowId(firstFolder), getObjectRowId(secondObject)]), secondObject, folders, objects);
    expect([...mixed.selectedKeys]).toEqual([getObjectRowId(secondObject)]);
    expect(mixed.objects).toEqual([secondObject]);
  });

  it("'all' selection は右クリック時点の明示 key 集合へ畳む", () => {
    const result = getContextSelection('all', firstObject, [], objects);

    expect(result.selectedKeys).toEqual(new Set(objects.map(getObjectRowId)));
    expect(result.objects).toEqual(objects);
  });
});

describe('removeObjectsFromPages', () => {
  it('全 page から対象 key だけを除き folders/next/pageParams を保つ', () => {
    const pages: readonly ObjectPage[] = [
      { folders, objects: [firstObject, secondObject], next: { kind: 'more', cursor: 'next' } },
      { folders: [], objects: objects.slice(2), next: { kind: 'end' } },
    ];
    const data: InfiniteData<ObjectPage, string | undefined> = { pages: [...pages], pageParams: [undefined, 'next'] };

    const result = removeObjectsFromPages(data, [secondObject]);

    expect(result.pages.map((page) => page.objects.map((object) => object.key))).toEqual([['a.txt'], ['c.txt']]);
    expect(result.pages.map((page) => page.folders)).toEqual([folders, []]);
    expect(result.pages.map((page) => page.next)).toEqual([{ kind: 'more', cursor: 'next' }, { kind: 'end' }]);
    expect(result.pageParams).toEqual([undefined, 'next']);
  });
});
