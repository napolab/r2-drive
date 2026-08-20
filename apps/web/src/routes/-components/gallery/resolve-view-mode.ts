export type ViewMode = 'gallery' | 'tiles';

// `?mode=tiles` は常にタイル固定。指定が無くても画像が 1 件も無ければタイルに
// 落とす — skyline レイアウトは画像前提なので、画像 0 件のフォルダでギャラリーを
// 見せても空の帯にしかならない(受け入れ基準はタイルの方が読みやすい)。
export const resolveViewMode = (requested: 'tiles' | undefined, hasImages: boolean): ViewMode => (requested === 'tiles' || !hasImages ? 'tiles' : 'gallery');
