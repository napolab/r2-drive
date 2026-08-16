import { useCallback, useMemo, useRef } from 'react';
import { Menu, MenuItem, Popover } from 'react-aria-components';

import { objectActions } from '../../../plugins/object-action/registry';
import * as styles from './styles.css';

import type { ObjectDescriptor } from '@r2-drive/core';
import type { CSSProperties } from 'react';
import type { Key } from 'react-aria-components';
import type { ActionDescriptor } from '../../../plugins/object-action/types';

export type ObjectContextMenuState =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'open';
      readonly objects: readonly ObjectDescriptor[];
      readonly point: { readonly x: number; readonly y: number };
      readonly trigger: HTMLElement;
    };

type Props = {
  readonly state: ObjectContextMenuState;
  readonly onAction: (action: ActionDescriptor) => void;
  readonly onClose: () => void;
};

type AnchorStyle = CSSProperties & { readonly '--context-menu-x': string; readonly '--context-menu-y': string };

class MissingContextActionError extends Error {
  override name = 'MissingContextActionError';
}

const resolveDescriptors = (objects: readonly ObjectDescriptor[]): readonly ActionDescriptor[] =>
  objectActions.map((action) =>
    action.run({ actionId: action.id, objects }).match(
      (descriptor) => descriptor,
      () => {
        throw new Error(`canonical object action ${action.id} did not resolve`);
      },
    ),
  );

export const ObjectContextMenu = ({ state, onAction, onClose }: Props) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const objects = state.kind === 'open' ? state.objects : [];
  const descriptors = useMemo(() => resolveDescriptors(objects), [objects]);
  const anchorStyle = useMemo<AnchorStyle>(
    () => ({
      '--context-menu-x': `${state.kind === 'open' ? state.point.x : 0}px`,
      '--context-menu-y': `${state.kind === 'open' ? state.point.y : 0}px`,
    }),
    [state],
  );
  const handleClose = useCallback(() => {
    const trigger = state.kind === 'open' ? state.trigger : undefined;
    onClose();
    if (trigger !== undefined) queueMicrotask(() => trigger.focus());
  }, [onClose, state]);
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) handleClose();
    },
    [handleClose],
  );
  const handleAction = useCallback(
    (key: Key) => {
      const descriptor = descriptors.find((candidate) => candidate.actionId === key);
      if (descriptor === undefined) throw new MissingContextActionError(`context action is missing: ${String(key)}`);
      onAction(descriptor);
      // Delete opens an alertdialog whose initial focus must win. The other
      // actions close back to the originating tile.
      if (descriptor.actionId !== 'delete') handleClose();
    },
    [descriptors, handleClose, onAction],
  );

  return (
    <>
      <span ref={anchorRef} className={styles.anchor} data-testid="object-context-anchor" style={anchorStyle} />
      <Popover className={styles.popoverRoot} triggerRef={anchorRef} placement="bottom start" offset={0} isOpen={state.kind === 'open'} onOpenChange={handleOpenChange}>
        <Menu aria-label="ファイル操作" className={styles.menuRoot} autoFocus="first" onAction={handleAction}>
          {descriptors.map((descriptor) => (
            <MenuItem
              key={descriptor.actionId}
              id={descriptor.actionId}
              aria-label={descriptor.label}
              textValue={descriptor.label}
              className={styles.menuItem}
              data-destructive={descriptor.destructive || undefined}
            >
              <span>{descriptor.label}</span>
              {descriptor.actionId === 'delete' ? <kbd className={styles.shortcut}>Delete</kbd> : null}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </>
  );
};
