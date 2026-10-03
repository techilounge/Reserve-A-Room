export const ROOM_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** Largest original an Admin may choose. It is compressed in the browser before upload. */
export const ROOM_IMAGE_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** Hard limit for what is stored. The `room-images` bucket enforces the same 2 MB cap. */
export const ROOM_IMAGE_MAX_STORED_BYTES = 2 * 1024 * 1024;
/** Compression aims comfortably below the stored cap. */
export const ROOM_IMAGE_TARGET_BYTES = 1.5 * 1024 * 1024;
export const ROOM_IMAGE_MAX_COUNT = 4;
export const ROOM_IMAGE_MAX_DIMENSION = 1600;

export function validateRoomImage(file: Pick<File, "type" | "size">): string | null {
  if (!ROOM_IMAGE_TYPES.includes(file.type as (typeof ROOM_IMAGE_TYPES)[number])) {
    return "Please choose JPEG, PNG, or WebP images.";
  }
  if (file.size > ROOM_IMAGE_MAX_SOURCE_BYTES) return "Each image must be 10 MB or smaller.";
  return null;
}

export type RoomImageEncoder = (scale: number, quality: number) => Promise<Blob | null>;

/** Progressively stronger settings: quality first, then smaller dimensions. */
export const ROOM_IMAGE_COMPRESSION_STEPS: readonly { scale: number; quality: number }[] = [
  { scale: 1, quality: 0.82 },
  { scale: 1, quality: 0.7 },
  { scale: 1, quality: 0.6 },
  { scale: 0.85, quality: 0.6 },
  { scale: 0.7, quality: 0.55 },
  { scale: 0.55, quality: 0.5 },
  { scale: 0.4, quality: 0.5 },
];

/**
 * Returns the first encoding at or under the target size, trying stronger compression each
 * time, or null when nothing fits. Never returns something larger than the stored cap.
 */
export async function encodeUnderTarget(encode: RoomImageEncoder): Promise<Blob | null> {
  for (const step of ROOM_IMAGE_COMPRESSION_STEPS) {
    const blob = await encode(step.scale, step.quality);
    if (blob && blob.size <= ROOM_IMAGE_TARGET_BYTES) return blob;
  }
  return null;
}

function outputName(name: string, type: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-") || "room";
  return `${base}.${roomImageExtension(type) ?? "webp"}`;
}

/**
 * Resize and re-encode in the browser so any accepted original (up to 10 MB) is stored well
 * under 2 MB. An original that is already small and wouldn't shrink is kept untouched.
 */
export async function compressRoomImage(file: File): Promise<File> {
  const validation = validateRoomImage(file);
  if (validation) throw new Error(validation);

  const bitmap = await createImageBitmap(file);
  try {
    const longest = Math.max(bitmap.width, bitmap.height);
    const encode: RoomImageEncoder = async (scale, quality) => {
      const fit = Math.min(1, ROOM_IMAGE_MAX_DIMENSION / longest) * scale;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * fit));
      canvas.height = Math.max(1, Math.round(bitmap.height * fit));
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      const webp = await toBlob("image/webp");
      // Some browsers can't encode WebP and silently return PNG, which wouldn't shrink.
      return webp?.type === "image/webp" ? webp : toBlob("image/jpeg");
    };

    const blob = await encodeUnderTarget(encode);
    if (!blob) {
      if (file.size <= ROOM_IMAGE_MAX_STORED_BYTES) return file;
      throw new Error("This image couldn't be compressed enough. Please choose a smaller or simpler image.");
    }
    if (file.size <= ROOM_IMAGE_TARGET_BYTES && blob.size >= file.size) return file;
    return new File([blob], outputName(file.name, blob.type), { type: blob.type, lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export function roomImageExtension(type: string): string | null {
  return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : null;
}
