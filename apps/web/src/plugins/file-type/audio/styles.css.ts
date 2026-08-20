import { css } from '@styled/css';

export const viewerAudioRoot = css({
  display: 'grid',
  gap: 'element',
  placeItems: 'center',
  p: 'block',
});

export const viewerAudioName = css({
  fontFamily: 'mono',
  color: 'fg.default',
});

export const viewerAudio = css({
  w: '[100%]',
  maxW: '[calc(var(--sizes-grid-cell) * 20)]',
});
