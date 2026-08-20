// image/video/audio の各 viewer が onError から throw するためのエラー。
// 消費側(object-viewer overlay の ViewerErrorBoundary)は
// findCause(error, isInstanceOf(MediaLoadError)) で判別し、汎用の
// 「ビューアを読み込めませんでした」ではなく media 固有のメッセージを出す。
export class MediaLoadError extends Error {
  override name = 'MediaLoadError';
}
