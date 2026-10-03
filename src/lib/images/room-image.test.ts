import { describe, expect, it } from "vitest";

import {
  encodeUnderTarget,
  ROOM_IMAGE_MAX_SOURCE_BYTES,
  ROOM_IMAGE_MAX_STORED_BYTES,
  ROOM_IMAGE_TARGET_BYTES,
  roomImageExtension,
  validateRoomImage,
} from "./room-image";

const MB = 1024 * 1024;
const blobOfSize = (size: number) => ({ size }) as Blob;

describe("room image validation", () => {
  it("accepts the supported image types through ten megabytes", () => {
    expect(ROOM_IMAGE_MAX_SOURCE_BYTES).toBe(10 * MB);
    expect(validateRoomImage({ type: "image/jpeg", size: ROOM_IMAGE_MAX_SOURCE_BYTES })).toBeNull();
    expect(validateRoomImage({ type: "image/jpeg", size: 6 * MB })).toBeNull();
    expect(validateRoomImage({ type: "image/png", size: 100 })).toBeNull();
    expect(validateRoomImage({ type: "image/webp", size: 100 })).toBeNull();
  });

  it("rejects unsupported types and oversized sources", () => {
    expect(validateRoomImage({ type: "image/gif", size: 100 })).toMatch(/JPEG/);
    expect(validateRoomImage({ type: "image/jpeg", size: ROOM_IMAGE_MAX_SOURCE_BYTES + 1 })).toMatch(/10 MB/);
  });

  it("maps upload extensions from the verified MIME type", () => {
    expect(roomImageExtension("image/jpeg")).toBe("jpg");
    expect(roomImageExtension("image/webp")).toBe("webp");
    expect(roomImageExtension("image/gif")).toBeNull();
  });
});

describe("compression to the stored size", () => {
  it("keeps the stored cap at the storage bucket's 2 MB and aims below it", () => {
    expect(ROOM_IMAGE_MAX_STORED_BYTES).toBe(2 * MB);
    expect(ROOM_IMAGE_TARGET_BYTES).toBeLessThan(ROOM_IMAGE_MAX_STORED_BYTES);
  });

  it("stops at the first setting that fits", async () => {
    const calls: [number, number][] = [];
    const blob = await encodeUnderTarget(async (scale, quality) => {
      calls.push([scale, quality]);
      return blobOfSize(quality >= 0.8 ? 4 * MB : 1 * MB);
    });
    expect(blob?.size).toBe(1 * MB);
    expect(calls).toEqual([
      [1, 0.82],
      [1, 0.7],
    ]);
  });

  it("shrinks dimensions when quality alone isn't enough", async () => {
    const blob = await encodeUnderTarget(async (scale) => blobOfSize(scale === 1 ? 5 * MB : 1 * MB));
    expect(blob?.size).toBe(1 * MB);
  });

  it("gives up rather than return something too large, and tolerates failed encodes", async () => {
    expect(await encodeUnderTarget(async () => blobOfSize(8 * MB))).toBeNull();
    expect(await encodeUnderTarget(async () => null)).toBeNull();
  });
});
