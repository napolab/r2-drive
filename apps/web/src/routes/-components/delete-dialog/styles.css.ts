import { css } from '@styled/css';

export const overlay = css({
  position: 'fixed',
  inset: '0',
  zIndex: 'modal',
  display: 'grid',
  placeItems: 'center',
  p: 'page',
  bg: '[oklch(0 0 0 / 0.5)]',
});

export const modalRoot = css({
  width: '[100%]',
  maxW: '[calc(var(--sizes-grid-cell) * 20)]',
  bg: 'bg.canvas',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  boxShadow: 'xl',
});

export const dialogRoot = css({
  display: 'grid',
  gap: 'element',
  p: 'block',
  color: 'fg.default',
  outline: 'none',
});

export const heading = css({
  fontSize: 'lg',
  fontWeight: 'semibold',
  lineHeight: 'snug',
});

export const warning = css({
  color: 'danger.text',
  lineHeight: 'jp',
});

export const listRoot = css({
  display: 'grid',
  gap: 'inline',
  pl: 'block',
});

export const listItem = css({
  minW: '[0]',
  overflow: 'hidden',
  color: 'fg.muted',
  fontFamily: 'mono',
  fontSize: 'sm',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const remainder = css({
  color: 'fg.subtle',
  fontFamily: 'mono',
  fontSize: 'xs',
  fontVariantNumeric: 'tabular-nums',
});

export const error = css({
  color: 'danger.text',
  fontSize: 'sm',
  lineHeight: 'jp',
});

export const actionsRoot = css({
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 'element',
  mt: 'element',
});

export const button = css({
  display: 'inline-grid',
  placeItems: 'center',
  minH: 'targetComfortable',
  px: 'block',
  color: 'fg.default',
  bg: 'bg.subtle',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  cursor: 'pointer',
  '&[data-hovered]': { bg: 'bg.emphasis' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
  '&[data-disabled]': { cursor: 'not-allowed', opacity: 'disabled' },
});

export const dangerButton = css({
  display: 'inline-grid',
  placeItems: 'center',
  minH: 'targetComfortable',
  px: 'block',
  color: 'fg.onDanger',
  bg: 'danger.solid',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'danger.border',
  cursor: 'pointer',
  '&[data-hovered]': { bg: 'danger.solidHover' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
  '&[data-disabled]': { cursor: 'not-allowed', opacity: 'disabled' },
});
