import type { EditorSchema, SaveFile, ValidationIssue } from '@savemancer/sdk';

export type Request =
  | { id: number; type: 'open'; moduleId: string; files: SaveFile[] }
  | { id: number; type: 'save'; data: unknown };

export type Response =
  | { id: number; ok: true; type: 'opened'; data: unknown; schema: EditorSchema }
  | { id: number; ok: true; type: 'saved'; files: SaveFile[]; issues: ValidationIssue[]; changedBytes: number }
  | { id: number; ok: false; error: string };

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RequestBody = DistributiveOmit<Request, 'id'>;
