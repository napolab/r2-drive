// バックフィルは Phase 1 で唯一「時間をまたぐ処理」であり、状態機械がそのまま
// ワイヤに出る。「running のときだけ進捗がある」を 2 つの optional field で表さず、
// 各状態が自分に必要な情報だけを持つ variant にする(.claude/rules)。
//
// indexed は「索引に今ある行数」であってバックフィルが今回入れた件数ではない。
// 冪等な upsert で走るので「今回何件入れたか」は運用上の意味を持たない(2 回目は 0 件
// 更新でも索引は正しい)。運用者が見たいのは「R2 の件数に追いついたか」なので、
// 常に現在の総行数を返す。
export type BackfillStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'running'; readonly indexed: number }
  | { readonly kind: 'complete'; readonly indexed: number }
  | { readonly kind: 'failed'; readonly indexed: number; readonly reason: string };
