// R2 のキー空間には「/ で終わる共通接頭辞」しか存在しない。ディレクトリという実体は無い。
export type Prefix = string;

// 寸法は「画像で、両方分かっている」か「無い」かの 1 つの状態(親 spec §6)。
// width? / height? という 2 つの optional にしない。
export type MediaFacts = { readonly kind: 'image'; readonly width: number; readonly height: number } | { readonly kind: 'none' };

export const NO_MEDIA: MediaFacts = { kind: 'none' };

// DB の NULL 許容 2 列(width / height)からワイヤ variant への境界変換。
// どちらかが欠ける・0 以下は none(半端な値を image に昇格させない)。
export const mediaOf = (width: number | null | undefined, height: number | null | undefined): MediaFacts =>
  typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0 ? { kind: 'image', width, height } : NO_MEDIA;

export type ObjectDescriptor = {
  readonly bucketId: string;
  readonly key: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly uploadedAt: string; // ISO8601。JSON を越えるので Date にしない
  readonly etag: string;
  readonly media: MediaFacts;
};

export type FolderDescriptor = {
  readonly bucketId: string;
  readonly prefix: Prefix;
  readonly name: string;
};

// カーソルの有無を optional ではなく variant で表す(spec §6.1)。
export type NextPage = { readonly kind: 'more'; readonly cursor: string } | { readonly kind: 'end' };

export type ObjectPage = {
  readonly folders: readonly FolderDescriptor[];
  readonly objects: readonly ObjectDescriptor[];
  readonly next: NextPage;
};
