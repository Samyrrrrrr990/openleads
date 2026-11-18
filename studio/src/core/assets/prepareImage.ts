/**
 * Prepares an imported image for storage in a project.
 *
 * Images live inside the project document as data URIs so a project is one
 * self-contained thing that can be exported, copied and backed up without a
 * server. That is the right trade, but it puts a hard ceiling on size:
 *
 *   - base64 inflates bytes by about a third
 *   - the whole project has to fit in one Firestore document (~1 MB) to back up
 *   - the whole project has to be held in memory to render and export
 *
 * The old import path did none of this work. It rejected anything over 3 MB
 * and stored whatever survived verbatim, which meant an ordinary phone photo
 * could not be added at all, and a photo small enough to add was often big
 * enough to silently break backup.
 *
 * So imports are re-encoded rather than refused: decode, scale the long edge
 * down to something a web page actually needs, and re-encode to WebP. A 6 MB
 * camera JPEG comes out around 150 kB with no visible loss at page sizes.
 *
 * Vectors are passed through untouched — an SVG is already small, and
 * rasterising it would throw away the thing that makes it worth using.
 */

/** Long edge, in pixels, of a stored image. Beyond this is wasted bytes. */
const MAX_EDGE = 1600;

/** Quality ladder, tried in order until the result fits under the cap. */
const QUALITY_STEPS = [0.82, 0.7, 0.58];

/** Cap on the *encoded* result. Comfortably inside the backup limit. */
const MAX_ENCODED_BYTES = 600 * 1024;

/**
 * Cap on what we will accept off disk. Generous, because the whole point is
 * that we shrink it — this only exists to stop a 500 MB TIFF from locking up
 * the tab during decode.
 */
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;

export interface PreparedImage {
  /** Data URI ready to store on an AssetNode. */
  src: string;
  /** Encoded byte length, for reporting. */
  bytes: number;
  width: number;
  height: number;
  /** True when the image was rescaled or re-encoded rather than passed through. */
  processed: boolean;
}

export class ImageImportError extends Error {}

/**
 * Scales `width`x`height` so the long edge is at most `maxEdge`.
 * Never scales up: a small image stays exactly as it is.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge = MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };

  const scale = maxEdge / longest;
  return {
    // `max(1, …)` so an extreme aspect ratio cannot round a side down to zero,
    // which would make the canvas invalid.
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Picks the output format.
 *
 * WebP wherever it encodes, because it keeps alpha and is much smaller than
 * PNG for photographic content. Where it does not, the fallback has to respect
 * transparency: re-encoding a logo with a transparent background as JPEG
 * silently fills it black, which looks like a corruption bug rather than a
 * format choice.
 */
export function chooseOutputType(sourceType: string, webpSupported: boolean): string {
  if (webpSupported) return 'image/webp';
  return sourceType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
}

/** True when this canvas can actually produce WebP. Safari lagged for years. */
function canEncodeWebp(canvas: HTMLCanvasElement): boolean {
  return canvas.toDataURL('image/webp').startsWith('data:image/webp');
}

function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return 0;
  const base64 = dataUrl.slice(comma + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new ImageImportError('That file could not be read.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Decodes to something drawable.
 *
 * `createImageBitmap` is the fast path and handles most formats the browser
 * knows. It throws on formats the browser cannot decode at all — HEIC outside
 * Safari being the common one — so the caller turns that into a real message
 * rather than a silent failure.
 */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Fall through to the <img> path, which occasionally succeeds where
      // createImageBitmap does not.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () =>
        reject(new ImageImportError('This browser cannot read that image format.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function dimensionsOf(source: ImageBitmap | HTMLImageElement): { width: number; height: number } {
  return source instanceof HTMLImageElement
    ? { width: source.naturalWidth, height: source.naturalHeight }
    : { width: source.width, height: source.height };
}

/**
 * Turns a picked file into a stored image.
 *
 * Throws `ImageImportError` with a message meant for a person whenever the
 * file genuinely cannot be used.
 */
export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new ImageImportError(`${file.name} is not an image.`);
  }

  if (file.size > MAX_SOURCE_BYTES) {
    throw new ImageImportError(`${file.name} is over 40 MB, which is too big to open.`);
  }

  // Vectors: store as-is. Scaling one is meaningless and rasterising loses it.
  if (file.type === 'image/svg+xml') {
    const src = await readAsDataUrl(file);
    if (dataUrlBytes(src) > MAX_ENCODED_BYTES) {
      throw new ImageImportError(`${file.name} is an unusually large SVG. Simplify it first.`);
    }
    return { src, bytes: dataUrlBytes(src), width: 0, height: 0, processed: false };
  }

  const source = await decode(file);
  const natural = dimensionsOf(source);

  if (natural.width === 0 || natural.height === 0) {
    throw new ImageImportError(`${file.name} could not be decoded.`);
  }

  const target = fitWithin(natural.width, natural.height);

  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;

  const context = canvas.getContext('2d');
  if (!context) throw new ImageImportError('This browser could not process the image.');

  context.drawImage(source, 0, 0, target.width, target.height);
  if ('close' in source) source.close();

  const type = chooseOutputType(file.type, canEncodeWebp(canvas));

  let best = '';
  for (const quality of QUALITY_STEPS) {
    // PNG ignores the quality argument, so there is nothing to step through.
    best = canvas.toDataURL(type, quality);
    if (dataUrlBytes(best) <= MAX_ENCODED_BYTES || type === 'image/png') break;
  }

  const bytes = dataUrlBytes(best);
  if (bytes > MAX_ENCODED_BYTES) {
    throw new ImageImportError(
      `${file.name} is still ${Math.round(bytes / 1024)} kB after compression. Try a smaller crop.`,
    );
  }

  return {
    src: best,
    bytes,
    width: target.width,
    height: target.height,
    processed: true,
  };
}
