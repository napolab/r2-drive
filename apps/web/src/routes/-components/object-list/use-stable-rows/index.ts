import { useMemo, useRef } from 'react';

import { getFolderRowId, getObjectRowId } from '../row-id';

import type { FolderDescriptor, ObjectDescriptor } from '@r2-drive/core';

// フォルダとオブジェクトを 1 つの union にまとめる。variant が増えたときに
// ObjectRow の switch がコンパイルエラーになる。
export type Row = { readonly kind: 'folder'; readonly id: string; readonly folder: FolderDescriptor } | { readonly kind: 'object'; readonly id: string; readonly object: ObjectDescriptor };

// react-aria-components の useCachedChildren は item の「オブジェクト参照」を key にした
// WeakMap でキャッシュしている(key 文字列ではない)。素朴に `rows` を毎回作り直すと
// 既存ページの Row も含めて全件が新しい参照になり、全件キャッシュミスする。すると
// CollectionDocument.queueUpdate が dirty ノードありと判断し、BaseCollection.clone() が
// `new Map(this.keyMap)` で現在の keyMap 全体をコピーし直す O(総件数) の再構築を
// 毎ページ発火させる。詳細は reports/2026-08-19-criterion-1-root-cause-measurement.md。
//
// この Row キャッシュは「中身の参照が変わっていない限り、同じ Row オブジェクトを返す」ことで
// react-aria 側の差分検出を有効なまま保つ。folder/object 自体の参照は
// useInfiniteQuery が pages 配列を作り直しても安定している(既存ページの要素は再利用される)ので、
// キャッシュ判定は folder/object の参照比較だけで足りる。
export const useStableRows = (folders: readonly FolderDescriptor[], objects: readonly ObjectDescriptor[]): readonly Row[] => {
  const cacheRef = useRef<Map<string, Row>>(new Map());

  return useMemo(() => {
    const previousCache = cacheRef.current;
    const nextCache = new Map<string, Row>();

    const folderRows = folders.map((folder): Row => {
      const id = getFolderRowId(folder);
      const cached = previousCache.get(id);
      const row = cached !== undefined && cached.kind === 'folder' && cached.folder === folder ? cached : { kind: 'folder' as const, id, folder };
      nextCache.set(id, row);
      return row;
    });

    const objectRows = objects.map((object): Row => {
      const id = getObjectRowId(object);
      const cached = previousCache.get(id);
      const row = cached !== undefined && cached.kind === 'object' && cached.object === object ? cached : { kind: 'object' as const, id, object };
      nextCache.set(id, row);
      return row;
    });

    // 消えたエントリ(前ページに居たが今回登場しなかった folder/object)は持ち越さない。
    // 持ち越すとフォルダ遷移のたびに古い Row がリークする。
    cacheRef.current = nextCache;

    return [...folderRows, ...objectRows];
  }, [folders, objects]);
};
