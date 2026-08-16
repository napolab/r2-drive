import { css } from '@styled/css';

export const anchor = css({
  position: 'fixed',
  top: 'var(--context-menu-y)',
  left: 'var(--context-menu-x)',
  width: '[1px]',
  height: '[1px]',
  pointerEvents: 'none',
});

export const popoverRoot = css({
  zIndex: 'popover',
  minW: '[calc(var(--sizes-grid-cell) * 9)]',
  overflow: 'hidden',
  bg: 'bg.canvas',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  boxShadow: 'lg',
  outline: 'none',
});

export const menuRoot = css({
  display: 'grid',
  gap: 'inline',
  p: 'inline',
  outline: 'none',
});

export const menuItem = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'block',
  minH: 'targetComfortable',
  px: 'element',
  color: 'fg.default',
  cursor: 'pointer',
  outline: 'none',
  '&[data-focused]': { color: 'fg.onSolid', bg: 'accent.solid' },
  '&[data-destructive]': {
    mt: 'inline',
    pt: 'inline',
    color: 'danger.text',
    borderTopWidth: 'hairline',
    borderTopStyle: 'solid',
    borderTopColor: 'border.default',
  },
  '&[data-destructive][data-focused]': { color: 'fg.onDanger', bg: 'danger.solid' },
});

export const shortcut = css({
  color: 'fg.subtle',
  fontFamily: 'mono',
  fontSize: 'xs',
  '&[data-focused]': { color: 'fg.onSolid' },
});
