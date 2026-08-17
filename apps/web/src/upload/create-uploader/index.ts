import AwsS3 from '@uppy/aws-s3';
import Uppy from '@uppy/core';
import { request } from '@r2-drive/api/client';

import type { AwsS3Options, AwsS3Part } from '@uppy/aws-s3';
import type { ApiClient } from '@r2-drive/api/client';
import type { ClientResponse, InferResponseType } from 'hono/client';

import { createMultipartUploadCoordinator } from '../multipart-upload-coordinator/index';

import type { CleanupMultipartSession, MultipartSession } from '../multipart-upload-coordinator/index';

export const MULTIPART_THRESHOLD = 100 * 1024 * 1024;

export const shouldUseMultipart = (file: { readonly size: number | null }): boolean => file.size === null || file.size > MULTIPART_THRESHOLD;

export type UploadMeta = { readonly prefix: string };
export type UploadBody = Record<string, unknown>;
export type R2Uploader = Uppy<UploadMeta, UploadBody>;

type AwsS3OptionsInput = { readonly client: ApiClient; readonly bucketId: string; readonly prefix: string };
type CreateUploaderOptions = AwsS3OptionsInput & { readonly onUploadSuccess: () => void };
type MultipartUploadCoordinator = ReturnType<typeof createMultipartUploadCoordinator>;

class InvalidUploadPartError extends Error {
  override name = 'InvalidUploadPartError';
}

class InvalidUploadStateError extends Error {
  override name = 'InvalidUploadStateError';
}

const requestAtUppyEdge = <F extends () => Promise<ClientResponse<unknown>>>(send: F): Promise<InferResponseType<F, 200>> =>
  request(send).match(
    (value) => value,
    (error) => {
      throw error;
    },
  );

const contentTypeOf = (file: { readonly type: string }): string => (file.type === '' ? 'application/octet-stream' : file.type);

const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal !== undefined) signal.throwIfAborted();
};

const requireUploadID = (uploadId: string | undefined): string => {
  if (uploadId === undefined) throw new InvalidUploadStateError('Uppy did not provide an upload ID');
  return uploadId;
};

const toApiParts = (parts: AwsS3Part[]): { readonly partNumber: number; readonly etag: string }[] =>
  parts.map((part) => {
    if (part.PartNumber === undefined || part.ETag === undefined) throw new InvalidUploadPartError('Uppy returned an incomplete uploaded part');

    return { partNumber: part.PartNumber, etag: part.ETag };
  });

export const createAwsS3Options = ({ client, bucketId, prefix }: AwsS3OptionsInput, coordinator: MultipartUploadCoordinator) => {
  const cleanupMultipartSession: CleanupMultipartSession = async ({ uploadId, key }) => {
    await requestAtUppyEdge(() => client.uploads[':bucketId'][':uploadId'].$delete({ param: { bucketId, uploadId: requireUploadID(uploadId) }, query: { key } }));
  };

  return {
    allowedMetaFields: false,
    shouldUseMultipart,
    getUploadParameters: (file, { signal }) => {
      throwIfAborted(signal);
      const key = `${prefix}${file.name}`;

      return {
        method: 'PUT',
        url: client.uploads[':bucketId'].single.$url({ param: { bucketId }, query: { key } }).toString(),
        fields: {},
        headers: { 'content-type': contentTypeOf(file) },
      };
    },
    createMultipartUpload: async (file) => {
      const attempt = coordinator.begin(file.id);
      let created: MultipartSession;
      try {
        created = await requestAtUppyEdge(() =>
          client.uploads[':bucketId'].$post({
            param: { bucketId },
            json: { key: `${prefix}${file.name}`, contentType: contentTypeOf(file) },
          }),
        );
      } catch (cause) {
        coordinator.createFailed(attempt, cause);
        throw cause;
      }

      return coordinator.created(attempt, created, cleanupMultipartSession);
    },
    listParts: (_file, { signal }) => {
      throwIfAborted(signal);
      // Phase 0 は uploadId を永続化しないため、復元対象の既存 part は無い。
      return [];
    },
    signPart: (_file, { uploadId, key, partNumber, signal }) => {
      throwIfAborted(signal);

      return {
        method: 'PUT',
        url: client.uploads[':bucketId'][':uploadId'].parts[':partNumber'].$url({ param: { bucketId, uploadId, partNumber: `${partNumber}` }, query: { key } }).toString(),
        fields: {},
        headers: {},
      };
    },
    completeMultipartUpload: async (_file, { uploadId, key, parts, signal }) => {
      const session = { uploadId: requireUploadID(uploadId), key };
      let completed: { readonly key: string; readonly etag: string };
      try {
        completed = await requestAtUppyEdge(() =>
          client.uploads[':bucketId'][':uploadId'].complete.$post(
            {
              param: { bucketId, uploadId: session.uploadId },
              json: { key, parts: toApiParts(parts) },
            },
            { init: { signal } },
          ),
        );
      } catch (cause) {
        coordinator.uploadFailed(_file.id, session, cause);
        throw cause;
      }
      coordinator.complete(_file.id, session);
      // Uppy に返す完了 URL。complete 応答の etag をそのまま ?v= に載せる
      // (一覧が組み立てる URL と同じ content-addressed な形になる)。
      const location = client.buckets[':bucketId'].content[':path{.+}'].$url({ param: { bucketId, path: completed.key }, query: { v: completed.etag } }).toString();

      return { location, key: completed.key, bucket: bucketId };
    },
    abortMultipartUpload: async (_file, { uploadId, key }) => {
      // この callback は upload 本体を止めた後の cleanup。Uppy から渡る signal は
      // 既に aborted の場合があるため、DELETE へ伝播すると R2 session が残る。
      await coordinator.abort(_file.id, { uploadId: requireUploadID(uploadId), key }, cleanupMultipartSession);
    },
  } satisfies AwsS3Options<UploadMeta, UploadBody>;
};

export const createUploader = ({ client, bucketId, prefix, onUploadSuccess }: CreateUploaderOptions): R2Uploader => {
  const uppy = new Uppy<UploadMeta, UploadBody>({ autoProceed: true, meta: { prefix } });
  const coordinator = createMultipartUploadCoordinator({ onCleanupError: (error) => uppy.info(error.message, 'error') });
  uppy.use(AwsS3<UploadMeta, UploadBody>, createAwsS3Options({ client, bucketId, prefix }, coordinator));
  uppy.on('file-removed', (file) => coordinator.cancelFile(file.id));
  uppy.on('cancel-all', () => coordinator.cancelAll());
  uppy.on('upload-success', () => onUploadSuccess());

  return uppy;
};
