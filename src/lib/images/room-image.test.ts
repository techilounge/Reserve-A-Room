import { describe, expect, it } from "vitest";

import { ROOM_IMAGE_MAX_BYTES, roomImageExtension, validateRoomImage } from "./room-image";

describe("room image validation", () => {
  it("allows the supported image types through two megabytes", () => {
    expect(validateRoomImage({ type: "image/jpeg", size: ROOM_IMAGE_MAX_BYTES })).toBeNull();
    expect(validateRoomImage({ type: "image/png", size: 100 })).toBeNull();
    expect(validateRoomImage({ type: "image/webp", size: 100 })).toBeNull();
  });

  it("rejects unsupported types and oversized sources", () => {
    expect(validateRoomImage({ type: "image/gif", size: 100 })).toMatch(/JPEG/);
    expect(validateRoomImage({ type: "image/jpeg", size: ROOM_IMAGE_MAX_BYTES + 1 })).toMatch(/2 MB/);
  });

  it("maps upload extensions from the verified MIME type", () => {
    expect(roomImageExtension("image/jpeg")).toBe("jpg");
    expect(roomImageExtension("image/webp")).toBe("webp");
    expect(roomImageExtension("image/gif")).toBeNull();
  });
});
