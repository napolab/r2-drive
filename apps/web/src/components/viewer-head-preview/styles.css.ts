import { css } from '@styled/css';

export const root = css({
  display: 'grid',
  gap: 'element',
  alignContent: 'start',
});

export const notice = css({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 'element',
  p: 'block',
  borderBottomWidth: 'hairline',
  borderBottomStyle: 'solid',
  borderColor: 'border.default',
  color: 'fg.muted',
  fontSize: 'sm',
});

export const size = css({
  fontFamily: 'mono',
  fontVariantNumeric: 'tabular-nums',
});

export const download = css({
  color: 'accent.text',
  textDecoration: 'underline',
  whiteSpace: 'nowrap',
});
