export const ROOM_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const ROOM_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
export const ROOM_IMAGE_MAX_COUNT = 4;
export const ROOM_IMAGE_MAX_DIMENSION = 1600;

export function validateRoomImage(file: Pick<File, "type" | "size">): string | null {
  if (!ROOM_IMAGE_TYPES.includes(file.type as (typeof ROOM_IMAGE_TYPES)[number])) {
    return "Please choose JPEG, PNG, or WebP images.";
  }
  if (file.size > ROOM_IMAGE_MAX_BYTES) return "Each image must be 2 MB or smaller.";
  return null;
}

function outputName(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_-]+/g, "-") || "room";
  return `${base}.webp`;
}

/** Resize and WebP-encode in the browser, retaining the original when it is already smaller. */
export async function compressRoomImage(file: File): Promise<File> {
  const validation = validateRoomImage(file);
  if (validation) throw new Error(validation);

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, ROOM_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], outputName(file.name), { type: "image/webp", lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

export function roomImageExtension(type: string): string | null {
  return type === "image/jpeg" ? "jpg" : type === "image/png" ? "png" : type === "image/webp" ? "webp" : null;
}
