import Uppy from '@uppy/core';
import { createApiClient } from '@r2-drive/api/client';
import { describe, expect, it, vi } from 'vitest';

import { createAwsS3Options, createUploader, shouldUseMultipart } from './index';
import { createMultipartUploadCoordinator } from '../multipart-upload-coordinator/index';

import type { ApiClient } from '@r2-drive/api/client';
import type { UppyFile } from '@uppy/core';

type UploadMeta = { readonly prefix: string };
type UploadBody = Record<string, unknown>;

const createFile = (name: string, type: string): { readonly file: UppyFile<UploadMeta, UploadBody>; readonly uppy: Uppy<UploadMeta, UploadBody> } => {
  const uppy = new Uppy<UploadMeta, UploadBody>({ meta: { prefix: '' } });
  const id = uppy.addFile({ name, type, data: new Blob(['payload'], { type }) });

  return { file: uppy.getFile(id), uppy };
};

const createClient = (fetch: typeof globalThis.fetch): ApiClient => createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch });
const createOptions = (input: Parameters<typeof createAwsS3Options>[0]) => createAwsS3Options(input, createMultipartUploadCoordinator({ onCleanupError: vi.fn() }));

const getOnlyRequest = (requests: readonly Request[]): Request => {
  const [request] = requests;
  if (request === undefined) throw new Error('request was not recorded');
  return request;
};

const createDeferredResponse = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((next) => {
    resolve = next;
  });

  return { promise, resolve };
};

const createPendingMultipartUploader = () => {
  const createResponse = createDeferredResponse();
  const requests: Request[] = [];
  let notifyCreateStarted!: () => void;
  const createStarted = new Promise<void>((resolve) => {
    notifyCreateStarted = resolve;
  });
  const fakeFetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);

    if (request.method === 'POST' && new URL(request.url).pathname === '/api/uploads/photos') {
      notifyCreateStarted();
      return createResponse.promise;
    }

    if (request.method === 'DELETE') {
      return new Response(JSON.stringify({ aborted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    throw new Error(`unexpected request: ${request.method} ${request.url}`);
  };
  const uppy = createUploader({ client: createClient(fakeFetch), bucketId: 'photos', prefix: 'docs/', onUploadSuccess: vi.fn() });
  uppy.getPlugin('AwsS3Multipart')?.setOptions({ shouldUseMultipart: true });
  const id = uppy.addFile({
    name: 'pending.bin',
    type: 'application/octet-stream',
    data: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]),
  });

  return { createResponse, createStarted, id, requests, uppy };
};

describe('shouldUseMultipart', () => {
  it('100 MiB 以下は single PUT にする', () => {
    expect(shouldUseMultipart({ size: 0 })).toBe(false);
    expect(shouldUseMultipart({ size: 100 * 1024 * 1024 })).toBe(false);
  });

  it('100 MiB 超は multipart にする', () => {
    expect(shouldUseMultipart({ size: 100 * 1024 * 1024 + 1 })).toBe(true);
  });

  it('サイズ不明は multipart に倒す', () => {
    expect(shouldUseMultipart({ size: null })).toBe(true);
  });
});

describe('createAwsS3Options', () => {
  it('single PUT の URL・method・content type と prefix 付き key を生成する', async () => {
    const { file, uppy } = createFile('hello world.bin', '');
    const options = createOptions({ client: createClient(fetch), bucketId: 'photos', prefix: 'docs/' });

    const parameters = await options.getUploadParameters(file, { signal: new AbortController().signal });

    expect(parameters).toEqual({
      method: 'PUT',
      url: 'https://drive.test/api/uploads/photos/single?key=docs%2Fhello+world.bin',
      fields: {},
      headers: { 'content-type': 'application/octet-stream' },
    });
    uppy.destroy();
  });

  it('multipart create を typed client で送り API の uploadId と key を返す', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ uploadId: 'upload-1', key: 'docs/big.bin' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { file, uppy } = createFile('big.bin', 'application/custom');
    const options = createOptions({ client: createClient(fakeFetch), bucketId: 'photos', prefix: 'docs/' });

    await expect(options.createMultipartUpload(file)).resolves.toEqual({ uploadId: 'upload-1', key: 'docs/big.bin' });
    const request = getOnlyRequest(requests);
    expect(request.method).toBe('POST');
    expect(new URL(request.url).pathname).toBe('/api/uploads/photos');
    expect(await request.json()).toEqual({ key: 'docs/big.bin', contentType: 'application/custom' });
    uppy.destroy();
  });

  it('multipart create の API error を rejected promise にする', async () => {
    const fakeFetch: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ name: 'BucketNotFoundError', message: 'unknown bucket' }), { status: 404, headers: { 'content-type': 'application/json' } });
    const { file, uppy } = createFile('big.bin', 'application/octet-stream');
    const options = createOptions({ client: createClient(fakeFetch), bucketId: 'unknown', prefix: '' });

    await expect(options.createMultipartUpload(file)).rejects.toMatchObject({ name: 'BucketNotFoundError' });
    uppy.destroy();
  });

  it('part URL を Hono client から生成する', async () => {
    const { file, uppy } = createFile('big.bin', 'application/octet-stream');
    const options = createOptions({ client: createClient(fetch), bucketId: 'photos', prefix: 'docs/' });

    expect(
      options.signPart(file, {
        uploadId: 'upload 1',
        key: 'docs/big.bin',
        partNumber: 2,
        body: new Blob(['part']),
        signal: new AbortController().signal,
      }),
    ).toEqual({ method: 'PUT', url: 'https://drive.test/api/uploads/photos/upload%201/parts/2?key=docs%2Fbig.bin', fields: {}, headers: {} });
    uppy.destroy();
  });

  it('complete で Uppy casing を API body に写し、content location を返す', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ key: 'docs/big.bin', etag: 'complete-etag' }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { file, uppy } = createFile('big.bin', 'application/octet-stream');
    const options = createOptions({ client: createClient(fakeFetch), bucketId: 'photos', prefix: 'docs/' });

    await expect(
      options.completeMultipartUpload(file, {
        uploadId: 'upload-1',
        key: 'docs/big.bin',
        parts: [{ PartNumber: 1, ETag: 'part-etag' }],
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ location: 'https://drive.test/api/buckets/photos/content/docs/big.bin', key: 'docs/big.bin', bucket: 'photos' });
    const request = getOnlyRequest(requests);
    expect(request.method).toBe('POST');
    expect(await request.json()).toEqual({ key: 'docs/big.bin', parts: [{ partNumber: 1, etag: 'part-etag' }] });
    uppy.destroy();
  });

  it('explicit cancel 用の abort request を送る', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      if (init?.signal?.aborted === true) throw init.signal.reason;
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ aborted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const { file, uppy } = createFile('big.bin', 'application/octet-stream');
    const options = createOptions({ client: createClient(fakeFetch), bucketId: 'photos', prefix: 'docs/' });
    const controller = new AbortController();
    controller.abort(new DOMException('upload cancelled', 'AbortError'));

    await options.abortMultipartUpload(file, { uploadId: 'upload-1', key: 'docs/big.bin', signal: controller.signal });

    const request = getOnlyRequest(requests);
    expect(request.method).toBe('DELETE');
    expect(request.url).toBe('https://drive.test/api/uploads/photos/upload-1?key=docs%2Fbig.bin');
    uppy.destroy();
  });
});

describe('createUploader', () => {
  it('autoProceed と prefix meta を持ち upload-success callback を一度呼ぶ', () => {
    const onUploadSuccess = vi.fn();
    const uppy = createUploader({ client: createClient(fetch), bucketId: 'photos', prefix: 'docs/', onUploadSuccess });

    expect(uppy.opts.autoProceed).toBe(true);
    expect(uppy.getState().meta).toEqual({ prefix: 'docs/' });

    uppy.emit('upload-success', undefined, { status: 200, body: {}, uploadURL: 'https://drive.test/object' });

    expect(onUploadSuccess).toHaveBeenCalledOnce();
    uppy.destroy();
  });

  it.each([
    ['removeFile', (uppy: Uppy<UploadMeta, UploadBody>, id: string) => uppy.removeFile(id)],
    ['destroy', (uppy: Uppy<UploadMeta, UploadBody>) => uppy.destroy()],
  ])('pending multipart create 中の %s を response 後の typed DELETE で補償する', async (_label, cancel) => {
    const { createResponse, createStarted, id, requests, uppy } = createPendingMultipartUploader();
    await createStarted;

    cancel(uppy, id);
    createResponse.resolve(new Response(JSON.stringify({ uploadId: 'upload-1', key: 'docs/pending.bin' }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await vi.waitFor(
      () => {
        expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
      },
      { timeout: 500 },
    );
    const [request] = requests.filter((candidate) => candidate.method === 'DELETE');
    expect(request?.url).toBe('https://drive.test/api/uploads/photos/upload-1?key=docs%2Fpending.bin');
    expect(uppy.getFiles()).toHaveLength(0);

    if (_label === 'removeFile') uppy.destroy();
  });

  it('created multipart session の removeFile と Uppy abort が競合しても typed DELETE は一度だけ', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      requests.push(request);
      if (request.method === 'POST') {
        return new Response(JSON.stringify({ uploadId: 'upload-created', key: 'docs/created.bin' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (request.method === 'DELETE') {
        return new Response(JSON.stringify({ aborted: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected request: ${request.method} ${request.url}`);
    };
    let notifySignStarted!: () => void;
    const signStarted = new Promise<void>((resolve) => {
      notifySignStarted = resolve;
    });
    const signResponse = createDeferredResponse();
    const uppy = createUploader({ client: createClient(fakeFetch), bucketId: 'photos', prefix: 'docs/', onUploadSuccess: vi.fn() });
    uppy.getPlugin('AwsS3Multipart')?.setOptions({
      shouldUseMultipart: true,
      signPart: async () => {
        notifySignStarted();
        const response = await signResponse.promise;
        return { url: response.url };
      },
    });
    const id = uppy.addFile({
      name: 'created.bin',
      type: 'application/octet-stream',
      data: new Blob([new Uint8Array(5 * 1024 * 1024 + 1)]),
    });
    await signStarted;

    uppy.removeFile(id);

    await vi.waitFor(() => expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1));
    signResponse.resolve(new Response(null, { status: 200 }));
    await Promise.resolve();
    expect(requests.filter((request) => request.method === 'DELETE')).toHaveLength(1);
    uppy.destroy();
  });
});
