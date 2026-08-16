export type MultipartSession = { readonly uploadId: string; readonly key: string };
export type CleanupMultipartSession = (session: MultipartSession) => Promise<void>;
export type MultipartCreateAttempt = { readonly fileId: string; readonly sequence: number };

type PendingState = { readonly kind: 'pending'; readonly attempt: MultipartCreateAttempt };
type CreatedState = {
  readonly kind: 'created';
  readonly attempt: MultipartCreateAttempt;
  readonly session: MultipartSession;
  readonly cleanup: CleanupMultipartSession;
};
type CancelledState =
  | { readonly kind: 'cancelled'; readonly phase: 'pending'; readonly attempt: MultipartCreateAttempt }
  | {
      readonly kind: 'cancelled';
      readonly phase: 'created';
      readonly attempt: MultipartCreateAttempt;
      readonly session: MultipartSession;
      readonly cleanup: CleanupMultipartSession;
    };
type CompleteState = { readonly kind: 'complete'; readonly attempt: MultipartCreateAttempt; readonly session: MultipartSession };
type ErrorState =
  | { readonly kind: 'error'; readonly phase: 'create'; readonly attempt: MultipartCreateAttempt; readonly cause: unknown }
  | {
      readonly kind: 'error';
      readonly phase: 'upload' | 'cleanup';
      readonly attempt: MultipartCreateAttempt;
      readonly session: MultipartSession;
      readonly cleanup: CleanupMultipartSession;
      readonly cause: unknown;
    };
type AttemptState = PendingState | CreatedState | CancelledState | CompleteState | ErrorState;
type TrackedAttempt = { state: AttemptState };

type CoordinatorOptions = { readonly onCleanupError: (error: MultipartCleanupError) => void };

class MultipartCreateCancelledError extends Error {
  override name = 'AbortError';

  constructor() {
    super('Multipart upload was cancelled before its session was created');
  }
}

export class MultipartCleanupError extends Error {
  override name = 'MultipartCleanupError';

  constructor(session: MultipartSession, cause: unknown) {
    super(`Multipart session ${session.uploadId} could not be cleaned up`, { cause });
  }
}

class InvalidMultipartAttemptError extends Error {
  override name = 'InvalidMultipartAttemptError';
}

const sameSession = (left: MultipartSession, right: MultipartSession): boolean => left.uploadId === right.uploadId && left.key === right.key;
const sessionKey = (fileId: string, session: MultipartSession): string => JSON.stringify([fileId, session.uploadId, session.key]);

export const createMultipartUploadCoordinator = ({ onCleanupError }: CoordinatorOptions) => {
  const attempts = new Map<number, TrackedAttempt>();
  const attemptsByFile = new Map<string, Set<number>>();
  const cleanups = new Map<string, Promise<void>>();
  let nextSequence = 0;

  const release = (tracked: TrackedAttempt): void => {
    const { attempt } = tracked.state;
    attempts.delete(attempt.sequence);
    const fileAttempts = attemptsByFile.get(attempt.fileId);
    fileAttempts?.delete(attempt.sequence);
    if (fileAttempts?.size === 0) attemptsByFile.delete(attempt.fileId);
  };

  const findSession = (fileId: string, session: MultipartSession): TrackedAttempt | undefined => {
    const fileAttempts = attemptsByFile.get(fileId);
    if (fileAttempts === undefined) return undefined;

    for (const sequence of fileAttempts) {
      const tracked = attempts.get(sequence);
      if (tracked === undefined) continue;
      const { state } = tracked;
      if (state.kind === 'created' && sameSession(state.session, session)) return tracked;
      if (state.kind === 'cancelled' && state.phase === 'created' && sameSession(state.session, session)) return tracked;
      if (state.kind === 'error' && state.phase !== 'create' && sameSession(state.session, session)) return tracked;
    }

    return undefined;
  };

  const cleanupOnce = (fileId: string, session: MultipartSession, cleanup: CleanupMultipartSession): Promise<void> => {
    const key = sessionKey(fileId, session);
    const existing = cleanups.get(key);
    if (existing !== undefined) return existing;

    const pending = Promise.resolve().then(() => cleanup(session));
    cleanups.set(key, pending);
    void pending.then(undefined, (cause: unknown) => {
      if (cleanups.get(key) === pending) cleanups.delete(key);
      onCleanupError(new MultipartCleanupError(session, cause));
    });
    return pending;
  };

  const cancelCreated = (tracked: TrackedAttempt, state: CreatedState | Extract<ErrorState, { phase: 'upload' | 'cleanup' }>): void => {
    tracked.state = { kind: 'cancelled', phase: 'created', attempt: state.attempt, session: state.session, cleanup: state.cleanup };
    const pending = cleanupOnce(state.attempt.fileId, state.session, state.cleanup);
    void pending.then(
      () => release(tracked),
      (cause: unknown) => {
        tracked.state = { kind: 'error', phase: 'cleanup', attempt: state.attempt, session: state.session, cleanup: state.cleanup, cause };
      },
    );
  };

  const cancelTracked = (tracked: TrackedAttempt): void => {
    const { state } = tracked;
    if (state.kind === 'pending') {
      tracked.state = { kind: 'cancelled', phase: 'pending', attempt: state.attempt };
      return;
    }
    if (state.kind === 'created') {
      cancelCreated(tracked, state);
      return;
    }
    if (state.kind === 'error' && state.phase !== 'create') cancelCreated(tracked, state);
  };

  const begin = (fileId: string): MultipartCreateAttempt => {
    const attempt = { fileId, sequence: nextSequence };
    nextSequence += 1;
    attempts.set(attempt.sequence, { state: { kind: 'pending', attempt } });
    const fileAttempts = attemptsByFile.get(fileId) ?? new Set<number>();
    fileAttempts.add(attempt.sequence);
    attemptsByFile.set(fileId, fileAttempts);
    return attempt;
  };

  const created = async (attempt: MultipartCreateAttempt, session: MultipartSession, cleanup: CleanupMultipartSession): Promise<MultipartSession> => {
    const tracked = attempts.get(attempt.sequence);
    if (tracked === undefined || tracked.state.attempt !== attempt) throw new InvalidMultipartAttemptError('Multipart create attempt is no longer active');

    if (tracked.state.kind === 'pending') {
      tracked.state = { kind: 'created', attempt, session, cleanup };
      return session;
    }

    if (tracked.state.kind !== 'cancelled' || tracked.state.phase !== 'pending') throw new InvalidMultipartAttemptError('Multipart create attempt has already settled');

    tracked.state = { kind: 'cancelled', phase: 'created', attempt, session, cleanup };
    const key = sessionKey(attempt.fileId, session);
    try {
      await cleanupOnce(attempt.fileId, session, cleanup);
    } catch (cause) {
      tracked.state = { kind: 'error', phase: 'cleanup', attempt, session, cleanup, cause };
      throw new MultipartCleanupError(session, cause);
    }
    release(tracked);
    cleanups.delete(key);
    throw new MultipartCreateCancelledError();
  };

  const createFailed = (attempt: MultipartCreateAttempt, cause: unknown): void => {
    const tracked = attempts.get(attempt.sequence);
    if (tracked === undefined || tracked.state.attempt !== attempt) return;
    tracked.state = { kind: 'error', phase: 'create', attempt, cause };
    release(tracked);
  };

  const uploadFailed = (fileId: string, session: MultipartSession, cause: unknown): void => {
    const tracked = findSession(fileId, session);
    if (tracked === undefined) return;
    const { state } = tracked;
    if (state.kind === 'created') tracked.state = { kind: 'error', phase: 'upload', attempt: state.attempt, session, cleanup: state.cleanup, cause };
  };

  const complete = (fileId: string, session: MultipartSession): void => {
    const tracked = findSession(fileId, session);
    if (tracked === undefined || tracked.state.kind !== 'created') return;
    tracked.state = { kind: 'complete', attempt: tracked.state.attempt, session };
    release(tracked);
    cleanups.delete(sessionKey(fileId, session));
  };

  const cancelFile = (fileId: string): void => {
    const fileAttempts = attemptsByFile.get(fileId);
    if (fileAttempts === undefined) return;
    for (const sequence of [...fileAttempts]) {
      const tracked = attempts.get(sequence);
      if (tracked !== undefined) cancelTracked(tracked);
    }
  };

  const cancelAll = (): void => {
    for (const tracked of [...attempts.values()]) cancelTracked(tracked);
  };

  const abort = async (fileId: string, session: MultipartSession, cleanup: CleanupMultipartSession): Promise<void> => {
    const tracked = findSession(fileId, session);
    const cleanupForSession =
      tracked?.state.kind === 'created' || (tracked?.state.kind === 'cancelled' && tracked.state.phase === 'created') || (tracked?.state.kind === 'error' && tracked.state.phase !== 'create')
        ? tracked.state.cleanup
        : cleanup;
    const key = sessionKey(fileId, session);
    await cleanupOnce(fileId, session, cleanupForSession);
    if (tracked !== undefined) release(tracked);
    cleanups.delete(key);
  };

  return { abort, begin, cancelAll, cancelFile, complete, created, createFailed, uploadFailed };
};
