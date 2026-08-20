import { createApiClient } from '@r2-drive/api/client';
import { NO_MEDIA } from '@r2-drive/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { deleteAction } from './index';

import type { ApiClient } from '@r2-drive/api/client';
import type { ObjectDescriptor } from '@r2-drive/core';
import type { ActionDescriptor } from '../types';

const clientState = vi.hoisted((): { current: ApiClient | undefined } => ({ current: undefined }));

vi.mock('../../../api/client', () => ({
  getApiClient: () => {
    if (clientState.current === undefined) throw new Error('test API client was not configured');
    return clientState.current;
  },
}));

const object: ObjectDescriptor = {
  bucketId: 'photos',
  key: 'docs/readme file.txt',
  name: 'readme file.txt',
  contentType: 'text/plain',
  size: 10,
  uploadedAt: '2026-08-14T00:00:00.000Z',
  etag: 'readme',
  media: NO_MEDIA,
};

const getDescriptor = (): ActionDescriptor =>
  deleteAction.run({ actionId: 'delete', objects: [object] }).match(
    (descriptor) => descriptor,
    () => {
      throw new Error('delete action did not match its own id');
    },
  );

beforeEach(() => {
  clientState.current = undefined;
});

describe('deleteAction', () => {
  it('typed delete route へ bucket と key を送り成功を解決する', async () => {
    const requests: Request[] = [];
    const fakeFetch: typeof fetch = async (input, init) => {
      requests.push(new Request(input, init));
      return new Response(JSON.stringify({ deleted: [object.key] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    clientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });

    await expect(getDescriptor().run([object])).resolves.toBeUndefined();

    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (request === undefined) throw new Error('delete request was not recorded');
    expect(request.method).toBe('DELETE');
    expect(new URL(request.url).pathname).toBe('/api/buckets/photos/objects/docs/readme%20file.txt');
  });

  it('Result error を ActionDescriptor の rejected promise に戻す', async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(JSON.stringify({ name: 'ObjectNotFoundError', message: 'missing object' }), { status: 404, headers: { 'content-type': 'application/json' } });
    clientState.current = createApiClient({ kind: 'ssr', origin: 'https://drive.test/api', fetch: fakeFetch });

    await expect(getDescriptor().run([object])).rejects.toMatchObject({ name: 'ObjectNotFoundError', message: 'missing object' });
  });
});
