import { css } from '@styled/css';

export const overlay = css({
  position: 'fixed',
  inset: '0',
  zIndex: 'modal',
  display: 'grid',
  placeItems: 'center',
  p: 'block',
  bg: '[oklch(0 0 0 / 0.5)]',
});

export const modalRoot = css({
  display: 'grid',
  w: '[100%]',
  h: '[100%]',
  bg: 'bg.canvas',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  boxShadow: 'xl',
});

export const dialogRoot = css({
  display: 'grid',
  gridTemplateRows: '[auto 1fr auto]',
  h: '[100%]',
  minH: '[0]',
  color: 'fg.default',
  outline: 'none',
});

export const header = css({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'element',
  p: 'element',
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.subtle',
});

export const headerName = css({
  fontFamily: 'mono',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

export const closeButton = css({
  px: 'element',
  py: 'inline',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  cursor: 'pointer',
});

export const body = css({
  display: 'grid',
  minH: '[0]',
  overflow: 'auto',
});

export const footer = css({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 'element',
  p: 'element',
  borderTopWidth: 'hairline',
  borderTopStyle: 'solid',
  borderTopColor: 'border.subtle',
});

export const navButton = css({
  px: 'element',
  py: 'inline',
  borderWidth: 'default',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  cursor: 'pointer',
  _disabled: { opacity: '[0.4]', cursor: 'default' },
});

export const meta = css({
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
  fontSize: 'sm',
  color: 'fg.muted',
});

export const stateNotice = css({
  placeSelf: 'center',
  p: 'block',
  color: 'fg.muted',
});

export const stateNoticeGroup = css({
  display: 'grid',
  gap: 'element',
  placeSelf: 'center',
  placeItems: 'center',
  p: 'block',
});
