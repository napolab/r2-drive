import { NO_MEDIA } from '@r2-drive/core';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useCallback, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { objectActions } from '../../../plugins/object-action/registry';
import { ObjectContextMenu } from './index';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { ActionDescriptor } from '../../../plugins/object-action/types';

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

const objects: readonly ObjectDescriptor[] = [
  {
    bucketId: 'photos',
    key: 'docs/readme.txt',
    name: 'readme.txt',
    contentType: 'text/plain',
    size: 10,
    uploadedAt: '2026-08-14T00:00:00.000Z',
    etag: 'readme',
    media: NO_MEDIA,
  },
];

const getDescriptors = (): readonly ActionDescriptor[] =>
  objectActions.map((action) =>
    action.run({ actionId: action.id, objects }).match(
      (descriptor) => descriptor,
      () => {
        throw new Error(`canonical action ${action.id} did not resolve`);
      },
    ),
  );

const renderOpenMenu = (onAction = vi.fn(), onClose = vi.fn()) => {
  const trigger = document.createElement('button');
  trigger.textContent = 'readme.txt';
  document.body.appendChild(trigger);
  const result = render(<ObjectContextMenu state={{ kind: 'open', objects, point: { x: 120, y: 240 }, trigger }} onAction={onAction} onClose={onClose} />);

  return { ...result, trigger, onAction, onClose };
};

describe('ObjectContextMenu', () => {
  it('canonical registry の全 action を同じ順序と label で示す', async () => {
    renderOpenMenu();

    const expected = getDescriptors();
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(expected.map((descriptor) => descriptor.label)));
  });

  it('danger action を識別し canonical descriptor を返す', async () => {
    const user = userEvent.setup();
    const { onAction } = renderOpenMenu();
    const deleteDescriptor = getDescriptors().find((descriptor) => descriptor.destructive);
    if (deleteDescriptor === undefined) throw new Error('delete descriptor was not registered');

    const item = await screen.findByRole('menuitem', { name: deleteDescriptor.label });
    expect(item.hasAttribute('data-destructive')).toBe(true);
    await user.click(item);

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ actionId: deleteDescriptor.actionId, label: deleteDescriptor.label, destructive: true }));
  });

  it('pointer 座標を CSS custom property の anchor に渡す', () => {
    renderOpenMenu();

    const anchor = screen.getByTestId('object-context-anchor');
    expect(anchor.style.getPropertyValue('--context-menu-x')).toBe('120px');
    expect(anchor.style.getPropertyValue('--context-menu-y')).toBe('240px');
  });

  it('Escape で閉じて元の tile へ focus を戻す', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    trigger.textContent = 'readme.txt';
    document.body.appendChild(trigger);
    const onClose = vi.fn();
    const Harness = () => {
      const [state, setState] = useState<import('./index').ObjectContextMenuState>({ kind: 'open', objects, point: { x: 120, y: 240 }, trigger });
      const handleClose = useCallback(() => {
        setState({ kind: 'closed' });
        onClose();
      }, []);

      return <ObjectContextMenu state={state} onAction={vi.fn()} onClose={handleClose} />;
    };
    render(<Harness />);

    await screen.findByRole('menu');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('action を実行して閉じた後も元の tile へ focus を戻す', async () => {
    const user = userEvent.setup();
    const trigger = document.createElement('button');
    trigger.textContent = 'readme.txt';
    document.body.appendChild(trigger);
    const onAction = vi.fn();
    const Harness = () => {
      const [state, setState] = useState<import('./index').ObjectContextMenuState>({ kind: 'open', objects, point: { x: 120, y: 240 }, trigger });
      const handleClose = useCallback(() => setState({ kind: 'closed' }), []);

      return <ObjectContextMenu state={state} onAction={onAction} onClose={handleClose} />;
    };
    render(<Harness />);

    const firstAction = getDescriptors()[0];
    if (firstAction === undefined) throw new Error('canonical action was not registered');
    await user.click(await screen.findByRole('menuitem', { name: firstAction.label }));

    await waitFor(() => expect(onAction).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
