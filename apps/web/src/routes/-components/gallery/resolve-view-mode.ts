export type ViewMode = 'gallery' | 'tiles';

// `?mode=tiles` は常にタイル固定。指定が無くても画像・動画が 1 件も無ければタイルに
// 落とす — skyline レイアウトはメディア前提なので、メディア 0 件のフォルダでギャラリーを
// 見せても空の帯にしかならない(受け入れ基準はタイルの方が読みやすい)。
export const resolveViewMode = (requested: 'tiles' | undefined, hasMedia: boolean): ViewMode => (requested === 'tiles' || !hasMedia ? 'tiles' : 'gallery');
