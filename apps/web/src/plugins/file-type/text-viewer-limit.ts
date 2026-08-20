// markdown / text ビューアは本文全体をクライアントに読む方式の防衛線。
// descriptor.size で事前判定し、超過時は fetch 自体を発行しない(spec §6.2)。
export const MAX_TEXT_VIEWER_BYTES = 1_048_576; // 1 MiB

export type TextViewerAdmission = { readonly kind: 'ok' } | { readonly kind: 'too-large'; readonly size: number };

export const admitTextViewer = (size: number): TextViewerAdmission => (size <= MAX_TEXT_VIEWER_BYTES ? { kind: 'ok' } : { kind: 'too-large', size });
