import { css } from '@styled/css';

export const root = css({
  display: 'block',
  w: '[100%]',
  h: '[100%]',
  objectFit: 'cover',
});

export const viewerImage = css({
  maxW: '[100%]',
  maxH: '[100%]',
  objectFit: 'contain',
  m: 'auto',
});

export const viewerErrorRoot = css({
  display: 'grid',
  gap: 'element',
  placeItems: 'center',
  p: 'block',
  color: 'fg.default',
});
