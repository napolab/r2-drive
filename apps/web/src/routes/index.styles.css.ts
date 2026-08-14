import { css } from '@styled/css';

export const pageRoot = css({ p: 'page' });

export const heading = css({ fontSize: 'xl', fontWeight: 'semibold', mb: 'block' });

export const listRoot = css({ display: 'grid', gap: 'inline' });

// 枠だけがこのタイルの存在と「押せること」を示す。だから機能側の border.interactive
// (bg.canvas に対して 3:1 以上を tokens.test.ts が強制)を使う。
export const item = css({
  display: 'grid',
  gridTemplateColumns: '1fr auto',
  alignItems: 'center',
  gap: 'element',
  minH: 'targetComfortable',
  px: 'element',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  color: 'fg.default',
  textDecoration: 'none',
  '&[data-status="active"]': { bg: 'bg.subtle' },
  '&:hover': { bg: 'bg.subtle' },
  '&:focus-visible': { layerStyle: 'focusRing' },
});

export const itemLabel = css({ fontSize: 'md' });

// バケット ID は識別子。等幅で組む。
export const itemId = css({ fontFamily: 'mono', fontSize: 'xs', color: 'fg.muted' });
