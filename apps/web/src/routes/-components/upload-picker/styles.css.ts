import { css } from '@styled/css';

export const button = css({
  minH: 'targetComfortable',
  px: 'element',
  color: 'fg.default',
  bg: 'bg.canvas',
  fontFamily: 'mono',
  fontSize: 'xs',
  fontWeight: 'medium',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  borderRadius: 'none',
  cursor: 'pointer',
  '&[data-hovered]': { bg: 'bg.subtle' },
  '&[data-pressed]': { bg: 'bg.muted' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
});
