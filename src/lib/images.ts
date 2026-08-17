// Hand-rolled PNG / JPEG header parser. Reads ~24 bytes from the front
// of the image to extract format + width + height. No `sharp` dependency,
// no `libvips` install — pure browser/Bun APIs only.

export type ImageFormat = "png" | "jpeg";

export interface ImageInfo {
  format: ImageFormat;
  width: number;
  height: number;
}

export class ImageError extends Error {
  constructor(
    public readonly field: "logo" | "banner",
    public readonly reason: "invalid_image" | "wrong_dimensions",
    msg: string,
  ) {
    super(`image(${field}): ${msg}`);
    this.name = "ImageError";
  }
}

// PNG signature (8 bytes) + IHDR chunk length (4 BE) + "IHDR" (4 bytes) +
// width (4 BE) + height (4 BE). All other PNG metadata comes after byte 24.
function readPngInfo(bytes: Uint8Array): ImageInfo | null {
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a &&
    bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52
  ) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return {
      format: "png",
      width: view.getUint32(16),
      height: view.getUint32(20),
    };
  }
  return null;
}

// JPEG: starts with FF D8 FF, then segments. Each non-standalone marker is
// FF XX followed by a 2-byte big-endian length. SOF markers (FFC0..FFC3,
// FFC5..FFC7, FFC9..FFCB, FFCD..FFCF — excludes DHT/JPG/DAC at FFC4/FFC8/FFCC)
// carry dimensions: 1-byte precision + 2-byte height + 2-byte width.
function readJpegInfo(bytes: Uint8Array): ImageInfo | null {
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)) return null;

  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    if (marker === 0xda) return null; // SOS — past metadata, no more SOF possible

    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSof) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const height = view.getUint16(offset + 5);
      const width = view.getUint16(offset + 7);
      return { format: "jpeg", width, height };
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const segLen = view.getUint16(offset + 2);
    offset += 2 + segLen;
  }
  return null;
}

export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 24) return null;
  return readPngInfo(bytes) ?? readJpegInfo(bytes);
}

export function validateDimensions(
  bytes: Uint8Array,
  expected: { width: number; height: number },
  field: "logo" | "banner",
): void {
  let info: ImageInfo | null;
  try {
    info = readImageInfo(bytes);
  } catch (err) {
    console.warn(`image validate ${field}: parser threw:`, err);
    throw new ImageError(field, "invalid_image", "could not parse image header");
  }

  if (!info) {
    throw new ImageError(field, "invalid_image", "not a PNG or JPEG");
  }

  if (info.width !== expected.width || info.height !== expected.height) {
    throw new ImageError(
      field,
      "wrong_dimensions",
      `must be exactly ${expected.width}x${expected.height} px, got ${info.width}x${info.height} px`,
    );
  }
}

export const EXPECTED_LOGO_SIZE = { width: 250, height: 250 } as const;
export const EXPECTED_BANNER_SIZE = { width: 600, height: 200 } as const;
