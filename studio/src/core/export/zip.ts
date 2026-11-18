/**
 * Packaging an export as a downloadable archive.
 */

import type { ExportResult } from './generate';

export async function buildZip(result: ExportResult): Promise<Blob> {
  // JSZip is ~100 kB and only needed at the moment someone downloads, so it
  // is fetched then rather than shipped in the initial bundle.
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  const root = zip.folder(result.slug) ?? zip;

  for (const file of result.files) {
    root.file(file.path, file.content, { binary: typeof file.content !== 'string' });
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** Triggers a browser download and revokes the object URL afterwards. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the browser a moment to start the download before releasing the URL.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
