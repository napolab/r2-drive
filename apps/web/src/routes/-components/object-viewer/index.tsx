import { useQuery } from '@tanstack/react-query';
import { Component, Suspense, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Dialog, Link, Modal, ModalOverlay } from 'react-aria-components';

import { findCause, isInstanceOf, ObjectNotFoundError } from '@r2-drive/core';

import { resolveFileType } from '../../../plugins/file-type/registry';
import { objectQuery } from '../../../queries/object';
import { findAdjacentViewable } from './use-viewer-navigation/index';
import * as styles from './styles.css';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';
import type { ReactNode } from 'react';

export type ViewerRequest = { readonly kind: 'closed' } | { readonly kind: 'open'; readonly objectKey: string };

type Props = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly objects: readonly ObjectDescriptor[];
  readonly request: ViewerRequest;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onClose: () => void;
  readonly onNavigate: (key: string) => void;
};

export const ObjectViewerOverlay = ({ client, bucketId, objects, request, getContentUrl, onClose, onNavigate }: Props) => {
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) onClose();
    },
    [onClose],
  );

  return (
    <ModalOverlay className={styles.overlay} isOpen={request.kind === 'open'} isDismissable onOpenChange={handleOpenChange}>
      <Modal className={styles.modalRoot}>
        {request.kind === 'open' ? (
          <ViewerDialog client={client} bucketId={bucketId} objects={objects} objectKey={request.objectKey} getContentUrl={getContentUrl} onClose={onClose} onNavigate={onNavigate} />
        ) : null}
      </Modal>
    </ModalOverlay>
  );
};

type ViewerDialogProps = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly objects: readonly ObjectDescriptor[];
  readonly objectKey: string;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
  readonly onClose: () => void;
  readonly onNavigate: (key: string) => void;
};

const ViewerDialog = ({ client, bucketId, objects, objectKey, getContentUrl, onClose, onNavigate }: ViewerDialogProps) => {
  const previous = useMemo(() => findAdjacentViewable(objects, objectKey, -1), [objects, objectKey]);
  const next = useMemo(() => findAdjacentViewable(objects, objectKey, 1), [objects, objectKey]);

  // 次が画像なら 1 枚だけ先読みする。連続閲覧の体感はこれが作る。
  useEffect(() => {
    if (next === undefined) return;
    const isImage = resolveFileType(next).match(
      (match) => match.typeId === 'image',
      () => false,
    );
    if (isImage) new Image().src = getContentUrl(next);
  }, [next, getContentUrl]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // video/audio のシーク(←/→)を奪わない
      if (event.target instanceof HTMLMediaElement) return;
      if (event.key === 'ArrowLeft' && previous !== undefined) onNavigate(previous.key);
      if (event.key === 'ArrowRight' && next !== undefined) onNavigate(next.key);
    },
    [previous, next, onNavigate],
  );

  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    // USEEFFECT_JUSTIFICATION: react-aria-components の Dialog は内部で
    // filterDOMProps(props, { global: true }) を通しており、`onKeyDown` は
    // globalEvents ホワイトリスト(マウス/ポインタ/ホイール/アニメーション系のみ)に
    // 無いため JSX prop として渡しても DOM へ届く前に落とされる(react-aria 側の
    // 既知の制約。子要素へ移してもフォーカスは Dialog 自身にあり bubble しないので
    // 子 div では拾えない)。Dialog の DOM ノードへ直接 addEventListener する以外に
    // このキー操作を拾う手段が無い。
    const node = dialogRef.current;
    if (node === null) return;
    node.addEventListener('keydown', handleKeyDown);
    return () => node.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handlePrevious = useCallback(() => {
    if (previous !== undefined) onNavigate(previous.key);
  }, [previous, onNavigate]);

  const handleNext = useCallback(() => {
    if (next !== undefined) onNavigate(next.key);
  }, [next, onNavigate]);

  const loaded = objects.find((object) => object.key === objectKey);

  return (
    <Dialog ref={dialogRef} className={styles.dialogRoot} aria-label={loaded?.name ?? objectKey}>
      <header className={styles.header}>
        <span className={styles.headerName}>{loaded?.name ?? objectKey}</span>
        <Button className={styles.closeButton} onPress={onClose}>
          閉じる
        </Button>
      </header>
      <div className={styles.body}>
        {loaded !== undefined ? (
          <ResolvedViewer object={loaded} getContentUrl={getContentUrl} />
        ) : (
          <FetchedViewer client={client} bucketId={bucketId} objectKey={objectKey} getContentUrl={getContentUrl} />
        )}
      </div>
      <footer className={styles.footer}>
        <Button className={styles.navButton} onPress={handlePrevious} isDisabled={previous === undefined}>
          ← 前へ
        </Button>
        {loaded !== undefined ? <ObjectMeta object={loaded} /> : <span className={styles.meta}>{objectKey}</span>}
        <Button className={styles.navButton} onPress={handleNext} isDisabled={next === undefined}>
          次へ →
        </Button>
      </footer>
    </Dialog>
  );
};

const byteFormat = new Intl.NumberFormat('en-US');

const ObjectMeta = ({ object }: { readonly object: ObjectDescriptor }) => (
  <span className={styles.meta}>
    {byteFormat.format(object.size)} B · {object.contentType} · {object.uploadedAt.slice(0, 10)}
  </span>
);

type FetchedViewerProps = {
  readonly client: ApiClient;
  readonly bucketId: string;
  readonly objectKey: string;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

const FetchedViewer = ({ client, bucketId, objectKey, getContentUrl }: FetchedViewerProps) => {
  const { data, error, isPending } = useQuery(objectQuery(client, bucketId, objectKey));

  if (isPending) return <p className={styles.stateNotice}>読み込み中</p>;
  if (error !== null) {
    if (findCause(error, isInstanceOf(ObjectNotFoundError)) !== undefined) {
      return (
        <p className={styles.stateNotice} role="alert">
          ファイルが見つかりません: {objectKey}
        </p>
      );
    }

    return (
      <p className={styles.stateNotice} role="alert">
        読み込みに失敗しました: {error.message}
      </p>
    );
  }

  return <ResolvedViewer object={data} getContentUrl={getContentUrl} />;
};

type ResolvedViewerProps = { readonly object: ObjectDescriptor; readonly getContentUrl: (object: ObjectDescriptor) => string };

const ResolvedViewer = ({ object, getContentUrl }: ResolvedViewerProps) => {
  return resolveFileType(object).match(
    (match) => {
      const capability = match.capability;
      switch (capability.kind) {
        case 'view':
          return (
            // object の identity(bucketId + key + etag)を key にして、prev/next で別ファイルへ
            // 移動したときにエラーバウンダリと配下(画像/動画/音声の hasLoadError など)を丸ごと
            // 再マウントする。key が無いと同じツリー位置で reconcile され、一度失敗した
            // hasError / hasLoadError が次のファイルにまで持ち越されてしまう。
            <ViewerErrorBoundary key={`${object.bucketId}:${object.key}:${object.etag}`} fallback={<ViewerLoadFailure object={object} getContentUrl={getContentUrl} />}>
              <Suspense fallback={<p className={styles.stateNotice}>読み込み中</p>}>
                <capability.Viewer object={object} getContentUrl={getContentUrl} />
              </Suspense>
            </ViewerErrorBoundary>
          );
        case 'opaque':
          return <OpaqueNotice object={object} getContentUrl={getContentUrl} />;
        default: {
          const _exhaustive: never = capability;
          throw new Error(`unhandled capability: ${JSON.stringify(_exhaustive)}`);
        }
      }
    },
    // opaquePlugin が最終防衛線なので err には到達しないが、型上の網羅として同じ表示に落とす
    () => <OpaqueNotice object={object} getContentUrl={getContentUrl} />,
  );
};

const OpaqueNotice = ({ object, getContentUrl }: ResolvedViewerProps) => (
  <div className={styles.stateNoticeGroup}>
    <p>このファイルは表示できません</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);

const ViewerLoadFailure = ({ object, getContentUrl }: ResolvedViewerProps) => (
  <div className={styles.stateNoticeGroup} role="alert">
    <p>ビューアを読み込めませんでした(再読み込みしてください)</p>
    <Link href={getContentUrl(object)} download={object.name}>
      ダウンロード
    </Link>
  </div>
);

type ViewerErrorBoundaryProps = { readonly fallback: ReactNode; readonly children: ReactNode };
type ViewerErrorBoundaryState = { readonly hasError: boolean };

class ViewerErrorBoundary extends Component<ViewerErrorBoundaryProps, ViewerErrorBoundaryState> {
  override state: ViewerErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ViewerErrorBoundaryState {
    return { hasError: true };
  }

  override render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}
