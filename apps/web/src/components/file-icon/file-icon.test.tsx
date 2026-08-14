import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FileIcon } from './index';

describe('FileIcon', () => {
  it('glyph を data 属性で公開する', () => {
    const { container } = render(<FileIcon size={16} glyph="image" />);

    expect(container.querySelector('svg')?.dataset.glyph).toBe('image');
  });

  it('装飾なので aria-hidden', () => {
    const { container } = render(<FileIcon size={16} glyph="doc" />);

    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
