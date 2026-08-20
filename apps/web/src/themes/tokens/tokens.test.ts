import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../contrast';
import { semanticTokens, tokens } from './index';

const val = (group: 'gray' | 'blue' | 'red', step: number): string => {
  const scale = tokens.colors[group] as Record<number, { value: string } | undefined>;
  const entry = scale[step];
  if (entry === undefined) throw new Error(`missing step ${step} in ${group}`);
  return entry.value;
};

describe('color ramps', () => {
  it('blue-9 is the electric brand blue', () => {
    expect(val('blue', 9)).toBe('oklch(0.490 0.287 266)');
  });
  it('red-9 is the vivid danger red', () => {
    expect(val('red', 9)).toBe('oklch(0.630 0.256 25)');
  });
  it('gray is a cool neutral (hue 265)', () => {
    expect(val('gray', 1)).toContain('265');
  });
  it('only blue, red, gray ramps exist (no pink/violet/cyan)', () => {
    expect(tokens.colors).not.toHaveProperty('pink');
    expect(tokens.colors).not.toHaveProperty('violet');
    expect(tokens.colors).not.toHaveProperty('cyan');
  });
});

describe('raw ramp WCAG (on paper gray-1)', () => {
  it('ink (gray-12) on paper >= 4.5', () => {
    expect(contrastRatio(val('gray', 12), val('gray', 1))).toBeGreaterThanOrEqual(4.5);
  });
  it('blue-9 on paper >= 4.5 (link text safe)', () => {
    expect(contrastRatio(val('blue', 9), val('gray', 1))).toBeGreaterThanOrEqual(4.5);
  });
  it('ink on red-9 >= 4.5 (black label on red button)', () => {
    expect(contrastRatio(val('gray', 12), val('red', 9))).toBeGreaterThanOrEqual(4.5);
  });
});

describe('typography tokens', () => {
  it('text scale base + explosive display clamp', () => {
    expect(tokens.fontSizes.md.value).toBe('1rem');
    expect(tokens.fontSizes.xl.value).toBe('1.4375rem'); // 23px
    expect(tokens.fontSizes.hero.value).toContain('clamp(');
  });
  it('editorial line-heights, Japanese body text set apart from Latin', () => {
    expect(tokens.lineHeights.none.value).toBe('0.9');
    expect(tokens.lineHeights.body.value).toBe('1.7');
    expect(tokens.lineHeights.jp.value).toBe('1.9');
  });
  it('body/display share the self-hosted M PLUS 1 stack, mono is system monospace', () => {
    expect(tokens.fonts.body.value).toContain('--font-mplus1');
    expect(tokens.fonts.display.value).toContain('--font-mplus1');
    expect(tokens.fonts.mono.value).toContain('ui-monospace');
  });
});

describe('shape tokens', () => {
  it('radius is sharp by default + pill only', () => {
    expect(tokens.radii.none.value).toBe('0');
    expect(tokens.radii.pill.value).toBe('9999px');
  });
  it('border widths are hairline/default/strong', () => {
    expect(tokens.borderWidths.hairline.value).toBe('1px');
    expect(tokens.borderWidths.default.value).toBe('2px');
    expect(tokens.borderWidths.strong.value).toBe('3px');
  });
  it('grid cell is the 24px module', () => {
    expect(tokens.sizes.gridCell.value).toBe('24px');
  });
  it('file tile dimensions stay on the 24px module', () => {
    expect(tokens.sizes.fileTileWidth.value).toBe('168px');
    expect(tokens.sizes.fileTileHeight.value).toBe('240px');
    expect(tokens.sizes.fileTileGap.value).toBe('12px');
    expect(tokens.sizes.fileNameArea.value).toBe('48px');
    expect(tokens.sizes.filePreviewIcon.value).toBe('72px');
  });
});

describe('motion tokens', () => {
  it('stepped easing for mechanical feel', () => {
    expect(tokens.easings.stepSnap.value).toBe('steps(3, end)');
    expect(tokens.easings.step1.value).toBe('steps(1)');
  });
  it('durations are defined', () => {
    expect(tokens.durations.base.value).toBe('150ms');
  });
});

// Semantic tokens hold *reference* strings like '{colors.gray.1}', not raw
// oklch values. `contrastRatio` only understands oklch strings, so resolve the
// reference against the primitive `tokens.colors` scale before checking it.
// Literals (e.g. 'oklch(0.260 0.020 265)') are passed through unchanged.
const resolve = (ref: string): string => {
  const m = ref.match(/\{colors\.(\w+)\.(\d+)\}/);
  if (m === null) {
    // If it looks like a literal oklch value, pass it through
    if (ref.startsWith('oklch(')) return ref;
    throw new Error(`unresolvable: ${ref}`);
  }
  const group = m[1];
  const step = m[2];
  if (group === undefined || step === undefined) throw new Error(`unresolvable: ${ref}`);
  const scale = tokens.colors[group as 'gray' | 'blue' | 'red'] as Record<number, { value: string } | undefined>;
  const entry = scale[parseInt(step, 10)];
  if (entry === undefined) throw new Error(`missing ${ref}`);
  return entry.value;
};

const sem = (path: string): string => {
  const node = path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], semanticTokens.colors);
  return (node as { value: string }).value;
};

describe('semantic tokens WCAG AA (light theme)', () => {
  const canvas = resolve(sem('bg.canvas'));
  it('fg.default on bg.canvas >= 4.5', () => {
    expect(contrastRatio(resolve(sem('fg.default')), canvas)).toBeGreaterThanOrEqual(4.5);
  });
  it('fg.muted on bg.canvas >= 4.5', () => {
    expect(contrastRatio(resolve(sem('fg.muted')), canvas)).toBeGreaterThanOrEqual(4.5);
  });
  it('accent.text on bg.canvas >= 4.5', () => {
    expect(contrastRatio(resolve(sem('accent.text')), canvas)).toBeGreaterThanOrEqual(4.5);
  });
  it('danger.text on bg.canvas >= 4.5', () => {
    expect(contrastRatio(resolve(sem('danger.text')), canvas)).toBeGreaterThanOrEqual(4.5);
  });
  it('fg.onSolid on accent.solid >= 4.5 (light label on blue button)', () => {
    expect(contrastRatio(resolve(sem('fg.onSolid')), resolve(sem('accent.solid')))).toBeGreaterThanOrEqual(4.5);
  });
  it('fg.onDanger on danger.solid >= 4.5 (light label on deep-red button)', () => {
    expect(contrastRatio(resolve(sem('fg.onDanger')), resolve(sem('danger.solid')))).toBeGreaterThanOrEqual(4.5);
  });
  // border.subtle/default/strong are decorative (row dividers, card outlines,
  // grid lines) — WCAG 1.4.11 does not apply to them, so they are not
  // constrained here. border.interactive/focus and accent.solid are the
  // border-family tokens that DO carry a "boundary is the only indicator"
  // responsibility, so they're the ones enforced at >= 3:1.
  it('border.interactive on bg.canvas >= 3.0 (non-text contrast, WCAG 1.4.11)', () => {
    expect(contrastRatio(resolve(sem('border.interactive')), canvas)).toBeGreaterThanOrEqual(3.0);
  });
  it('border.focus on bg.canvas >= 3.0 (non-text contrast, WCAG 1.4.11)', () => {
    expect(contrastRatio(resolve(sem('border.focus')), canvas)).toBeGreaterThanOrEqual(3.0);
  });
  it('accent.solid on bg.canvas >= 3.0 (focus ring outline color, layerStyles.focusRing)', () => {
    expect(contrastRatio(resolve(sem('accent.solid')), canvas)).toBeGreaterThanOrEqual(3.0);
  });
  it('danger.border on bg.canvas >= 3.0 (non-text contrast, WCAG 1.4.11)', () => {
    expect(contrastRatio(resolve(sem('danger.border')), canvas)).toBeGreaterThanOrEqual(3.0);
  });
  it('danger.spot preserves the vivid decorative red (red-9)', () => {
    expect(sem('danger.spot')).toBe('{colors.red.9}');
  });
});

describe('code tokens WCAG AA (on code.bg = gray.3)', () => {
  const codeBg = val('gray', 3);
  const textKeys = ['fg', 'comment', 'keyword', 'string', 'number', 'function', 'punctuation'] as const;

  it('code.bg is gray.3 (= bg.muted)', () => {
    expect(resolve(sem('code.bg'))).toBe(codeBg);
  });

  for (const key of textKeys) {
    it(`code.${key} on code.bg >= 4.5`, () => {
      expect(contrastRatio(resolve(sem(`code.${key}`)), codeBg)).toBeGreaterThanOrEqual(4.5);
    });
  }
});
