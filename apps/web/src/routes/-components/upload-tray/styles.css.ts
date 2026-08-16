import { css } from '@styled/css';

export const root = css({
  display: 'grid',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  gap: 'element',
  maxH: 'fileTileHeight',
  p: 'element',
  overflow: 'hidden',
  color: 'fg.default',
  bg: 'bg.subtle',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
});

export const headerRoot = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'inline' });

export const heading = css({ fontFamily: 'mono', fontSize: 'xs', fontWeight: 'semibold', letterSpacing: 'wider' });

export const count = css({ color: 'fg.muted', fontFamily: 'mono', fontSize: '2xs', fontVariantNumeric: 'tabular-nums' });

export const listRoot = css({ display: 'grid', gap: 'inline', overflowY: 'auto' });

export const itemRoot = css({
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  gap: 'inline',
  alignItems: 'center',
  p: 'inline',
  bg: 'bg.canvas',
  borderInlineStartWidth: 'strong',
  borderInlineStartStyle: 'solid',
  borderInlineStartColor: 'border.interactive',
  '&[data-state="uploading"]': { borderInlineStartColor: 'accent.solid' },
  '&[data-state="error"]': { borderInlineStartColor: 'danger.border' },
  '&[data-state="complete"]': { borderInlineStartColor: 'border.strong' },
});

export const itemMeta = css({ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'inline', minW: '[0]' });

export const fileName = css({ overflow: 'hidden', color: 'fg.default', fontFamily: 'mono', fontSize: 'xs', fontWeight: 'medium', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });

export const state = css({ flexShrink: '0', color: 'fg.muted', fontFamily: 'mono', fontSize: '2xs', letterSpacing: 'wide' });

export const progressRoot = css({ gridColumn: '[1]', minW: '[0]' });

export const progressTrack = css({ h: 'targetMin', overflow: 'hidden', bg: 'bg.muted', borderWidth: 'hairline', borderStyle: 'solid', borderColor: 'border.subtle' });

export const progressFill = css({ w: 'var(--upload-progress)', h: '[100%]', bg: 'accent.solid' });

export const cancelButton = css({
  gridColumn: '[2]',
  gridRow: '[1 / span 2]',
  minW: 'targetComfortable',
  minH: 'targetComfortable',
  px: 'inline',
  color: 'fg.default',
  bg: 'bg.canvas',
  fontFamily: 'mono',
  fontSize: 'xs',
  borderWidth: 'hairline',
  borderStyle: 'solid',
  borderColor: 'border.interactive',
  borderRadius: 'none',
  cursor: 'pointer',
  '&[data-hovered]': { bg: 'bg.emphasis' },
  '&[data-pressed]': { bg: 'bg.muted' },
  '&[data-focus-visible]': { layerStyle: 'focusRing' },
});

export const errorMessage = css({ gridColumn: '[1]', color: 'danger.text', fontFamily: 'mono', fontSize: '2xs' });
