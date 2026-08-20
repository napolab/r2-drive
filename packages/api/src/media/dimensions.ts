import { R2OperationError } from '@r2-drive/core';
import { imageSize } from 'image-size';
import { fromPromise } from 'neverthrow';

import type { DriveError } from '@r2-drive/core';
import type { ResultAsync } from 'neverthrow';

// ヘッダ解析に読む先頭バイト数。png/gif/webp はヘッダ先頭、jpeg の SOF も
// 実用上ほぼこの範囲に収まる。取れなければ「寸法なし」に倒す(spec §3.3)。
export const DIMENSION_PROBE_BYTES = 131_072;

export type ImageDimensions = { readonly width: number; readonly height: number };

const parseDimensions = (bytes: Uint8Array): ImageDimensions | undefined => {
  try {
    const { width, height } = imageSize(bytes);

    return typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { width, height } : undefined;
  } catch {
    // image-size は未対応形式・壊れた入力で throw する。「寸法が得られない」は正常系。
    return undefined;
  }
};

// R2GetOptions.range のバイト長は object のサイズを超えてもよい(R2 側が末尾で切り詰める)ため、
// DIMENSION_PROBE_BYTES を実サイズと比較する必要はない。
const readDimensions = async (bucket: R2Bucket, key: string): Promise<ImageDimensions | undefined> => {
  const object = await bucket.get(key, { range: { offset: 0, length: DIMENSION_PROBE_BYTES } });
  if (object === null) return undefined;

  return parseDimensions(new Uint8Array(await object.arrayBuffer()));
};

// 「寸法が得られなかった」(非画像 / 未対応形式 / 破損 / キー不在)は正常系 ok(undefined)。
// R2 の読み取り自体が失敗したときだけ err にする。
export const probeImageDimensions = (bucket: R2Bucket, key: string): ResultAsync<ImageDimensions | undefined, DriveError> =>
  fromPromise(readDimensions(bucket, key), (cause) => new R2OperationError(`dimension probe failed: ${key}`, { cause }));
