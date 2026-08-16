// Panda の生成済み layer を Vite + PostCSS に通し、browser component test へ
// production と同じ CSS を入れる。
import './src/styles.css';

// react-stately Virtualizer は test 環境かどうかを process.env で判定するが、
// 実ブラウザには Node の process global が無い。VIRT_ON を有効にして実 viewport を
// 測らせるため、browser test の入口だけに最小の env shim を置く。
Object.defineProperty(globalThis, 'process', {
  value: { env: { NODE_ENV: 'test', VIRT_ON: '1' } },
});
