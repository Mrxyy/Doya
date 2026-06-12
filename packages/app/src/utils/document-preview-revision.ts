export interface DocumentPreviewRevisionInput {
  path: string;
  size: number;
  modifiedAt: string | null | undefined;
  documentKind: string;
  bytes: Uint8Array;
}

export function createDocumentPreviewRevision(input: DocumentPreviewRevisionInput): string {
  return [
    input.path,
    input.size,
    input.modifiedAt ?? "",
    input.documentKind,
    input.bytes.byteLength,
    createDocumentBytesSignature(input.bytes),
  ].join(":");
}

export function createDocumentBytesSignature(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    hash ^= bytes[index] ?? 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
