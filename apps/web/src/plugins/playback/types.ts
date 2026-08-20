import type { ObjectDescriptor, Processor } from '@r2-drive/core';

export type PlaybackResolverInput = {
  readonly object: ObjectDescriptor;
  readonly getContentUrl: (object: ObjectDescriptor) => string;
};

export type PlaybackSource = { readonly kind: 'raw'; readonly src: string };
// Phase 6 で { kind: 'hls'; manifest: string } が加わる

export type PlaybackResolver = Processor<PlaybackResolverInput, PlaybackSource>;
