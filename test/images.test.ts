import { describe, expect, test } from "bun:test";
import {
  EXPECTED_LOGO_SIZE,
  EXPECTED_BANNER_SIZE,
  ImageError,
  readImageInfo,
  validateDimensions,
} from "../src/lib/images";

// Real PNG bytes — generated programmatically so the test is self-contained
// without external fixtures. We build a tiny 4x4 red PNG to test against.

function pngBytes(width: number, height: number): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  // IHDR chunk: length(4) "IHDR"(4) width(4) height(4) bit-depth(1) color(1)
  //             compression(1) filter(1) interlace(1) CRC(4)
  const ihdrLen = 13;
  const ihdr = [
    0, 0, 0, ihdrLen,
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    ...intBE(width, 4),
    ...intBE(height, 4),
    8,    // bit depth
    2,    // color type (RGB)
    0,    // compression
    0,    // filter
    0,    // interlace
  ];

  // IDAT chunk: minimal 4x4 RGB data, all red pixels.
  // zlib-compressed minimal data for 4x4 RGB (15 bytes raw, all 0xFF).
  // We don't actually need valid image data to test header parsing —
  // readImageInfo only reads the first 24 bytes.
  const idat = [
    0, 0, 0, 9,           // length (we'll fix this below)
    0x49, 0x44, 0x41, 0x54, // "IDAT"
    0x78, 0x9c, 0x63, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01, // zlib stream of 4x4 RGB
    0x5b, 0x6c, 0x5e, 0x6f, 0x00, 0x00, 0x00, 0x00,
  ];

  // IEND chunk
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];

  return new Uint8Array([...sig, ...ihdr, ...idat, ...iend]);
}

function intBE(n: number, bytes: number): number[] {
  const out: number[] = [];
  for (let i = bytes - 1; i >= 0; i--) out.push((n >> (i * 8)) & 0xff);
  return out;
}

// Minimal JPEG with a SOF0 marker — only headers are valid, image data
// is garbage. We only need this to exercise the JPEG parser.
function jpegBytes(width: number, height: number): Uint8Array {
  // FF D8 FF E0 (APP0) FF C0 (SOF0) len precision height width ...
  const sof: number[] = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, // APP0 stub (length 2)
    0xff, 0xc0,                            // SOF0 marker
    0x00, 0x0b,                            // length = 11
    8,                                      // precision
    ...intBE(height, 2),
    ...intBE(width, 2),
    3,                                      // components
    1, 0x11, 0,                            // Y
    2, 0x11, 1,                            // Cb
    3, 0x11, 1,                            // Cr
  ];
  return new Uint8Array([...sof, 0xff, 0xd9]); // ends with EOI
}

describe("readImageInfo", () => {
  test("reads PNG dimensions correctly", () => {
    const bytes = pngBytes(250, 250);
    const info = readImageInfo(bytes);
    expect(info).not.toBeNull();
    expect(info!.format).toBe("png");
    expect(info!.width).toBe(250);
    expect(info!.height).toBe(250);
  });

  test("reads JPEG dimensions correctly", () => {
    const bytes = jpegBytes(600, 200);
    const info = readImageInfo(bytes);
    expect(info).not.toBeNull();
    expect(info!.format).toBe("jpeg");
    expect(info!.width).toBe(600);
    expect(info!.height).toBe(200);
  });

  test("returns null for too-short input", () => {
    expect(readImageInfo(new Uint8Array(10))).toBeNull();
  });

  test("returns null for random garbage", () => {
    expect(readImageInfo(new Uint8Array(100).fill(0xab))).toBeNull();
  });
});

describe("validateDimensions", () => {
  test("passes for exact logo size", () => {
    expect(() => validateDimensions(pngBytes(250, 250), EXPECTED_LOGO_SIZE, "logo")).not.toThrow();
  });

  test("throws for off-by-one logo dimensions", () => {
    expect(() => validateDimensions(pngBytes(251, 250), EXPECTED_LOGO_SIZE, "logo")).toThrow(ImageError);
    expect(() => validateDimensions(pngBytes(250, 249), EXPECTED_LOGO_SIZE, "logo")).toThrow(ImageError);
  });

  test("passes for exact banner size", () => {
    expect(() => validateDimensions(pngBytes(600, 200), EXPECTED_BANNER_SIZE, "banner")).not.toThrow();
  });

  test("throws wrong_dimensions for 1080x2400 logo upload", () => {
    try {
      validateDimensions(pngBytes(1080, 2400), EXPECTED_LOGO_SIZE, "logo");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ImageError);
      expect((err as ImageError).reason).toBe("wrong_dimensions");
      expect((err as ImageError).field).toBe("logo");
      expect((err as Error).message).toContain("1080x2400");
      expect((err as Error).message).toContain("250x250");
    }
  });

  test("throws invalid_image for non-image bytes", () => {
    const garbage = new Uint8Array(100).fill(0xab);
    try {
      validateDimensions(garbage, EXPECTED_LOGO_SIZE, "logo");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ImageError);
      expect((err as ImageError).reason).toBe("invalid_image");
    }
  });

  test("JPEG with correct logo dimensions passes", () => {
    expect(() => validateDimensions(jpegBytes(250, 250), EXPECTED_LOGO_SIZE, "logo")).not.toThrow();
  });
});
