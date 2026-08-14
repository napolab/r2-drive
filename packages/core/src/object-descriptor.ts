// R2 のキー空間には「/ で終わる共通接頭辞」しか存在しない。ディレクトリという実体は無い。
export type Prefix = string;

export type ObjectDescriptor = {
  readonly bucketId: string;
  readonly key: string;
  readonly name: string;
  readonly contentType: string;
  readonly size: number;
  readonly uploadedAt: string; // ISO8601。JSON を越えるので Date にしない
  readonly etag: string;
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
