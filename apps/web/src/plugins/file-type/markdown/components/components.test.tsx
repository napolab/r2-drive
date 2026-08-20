import { cleanup, render, screen } from '@testing-library/react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { afterEach, describe, expect, it } from 'vitest';

import { markdownComponents } from './index';

afterEach(cleanup);

// react-perf(jsx-no-new-array-as-prop): remarkPlugins 配列を参照安定にする。
const remarkPlugins = [remarkGfm];

const fixture = `
# H1

## H2

### H3

[example link](https://example.com)

> quoted text

\`inline code\`

| a | b |
| --- | --- |
| 1 | 2 |
`;

describe('markdownComponents registry', () => {
  it('見出し h1〜h3 を描画する', () => {
    render(
      <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {fixture}
      </Markdown>,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'H1' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'H2' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'H3' })).toBeTruthy();
  });

  it('リンクを react-aria Link(a 要素 + href)で描画する', () => {
    render(
      <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {fixture}
      </Markdown>,
    );

    const link = screen.getByRole('link', { name: 'example link' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('https://example.com');
  });

  it('table を描画し、th/td にスタイルクラスを当てる', () => {
    const { container } = render(
      <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {fixture}
      </Markdown>,
    );

    const table = container.querySelector('table');
    const th = container.querySelector('th');
    const td = container.querySelector('td');

    expect(table).not.toBeNull();
    expect(th?.className).toBeTruthy();
    expect(td?.className).toBeTruthy();
  });

  it('blockquote と inline code を描画する', () => {
    const { container } = render(
      <Markdown remarkPlugins={remarkPlugins} components={markdownComponents}>
        {fixture}
      </Markdown>,
    );

    expect(container.querySelector('blockquote')?.textContent?.trim()).toBe('quoted text');
    expect(screen.getByText('inline code').tagName).toBe('CODE');
  });
});
