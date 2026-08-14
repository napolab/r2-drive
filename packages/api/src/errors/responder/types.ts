import type { Processor, ResponseSpec } from '@r2-drive/core';

export type ErrorResponder = Processor<Error, ResponseSpec>;
