"use client";

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { compressRoomImage, ROOM_IMAGE_MAX_COUNT, validateRoomImage } from "@/lib/images/room-image";

export type EditableRoomImage = {
  id: string;
  path: string | null;
  url: string;
  file: File | null;
};

export function RoomImagePicker({
  images,
  onChange,
  disabled,
}: {
  images: EditableRoomImage[];
  onChange: (images: EditableRoomImage[]) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [compressing, setCompressing] = useState(false);

  async function addFiles(files: File[]) {
    const remaining = ROOM_IMAGE_MAX_COUNT - images.length;
    if (remaining <= 0) return toast.error("A room can have up to four images.");
    if (files.length > remaining) toast.info(`Only the first ${remaining} image${remaining === 1 ? "" : "s"} will be added.`);

    setCompressing(true);
    try {
      const additions: EditableRoomImage[] = [];
      for (const file of files.slice(0, remaining)) {
        const error = validateRoomImage(file);
        if (error) {
          toast.error(`${file.name}: ${error}`);
          continue;
        }
        try {
          const compressed = await compressRoomImage(file);
          additions.push({ id: crypto.randomUUID(), path: null, url: URL.createObjectURL(compressed), file: compressed });
        } catch {
          toast.error(`${file.name} could not be processed. Please choose another image.`);
        }
      }
      if (additions.length) onChange([...images, ...additions]);
    } finally {
      setCompressing(false);
      if (input.current) input.current.value = "";
    }
  }

  function remove(index: number) {
    const item = images[index];
    if (item.file) URL.revokeObjectURL(item.url);
    onChange(images.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <section aria-labelledby="room-images-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <div>
        <h2 id="room-images-heading" className="text-lg font-semibold">Room images</h2>
        <p className="text-sm text-muted-foreground">Add up to four images. The first image is used on room cards.</p>
      </div>

      {images.length ? (
        <ol className="grid gap-3 sm:grid-cols-2">
          {images.map((image, index) => (
            <li key={image.id} className="overflow-hidden rounded-lg border bg-muted/30">
              <div className="relative aspect-[16/9]">
                <Image src={image.url} alt={`Room image ${index + 1}`} fill sizes="(min-width: 640px) 20rem, 100vw" unoptimized={image.url.startsWith("blob:")} className="object-cover" />
              </div>
              <div className="flex items-center justify-between gap-2 p-2">
                <span className="text-sm font-medium">{index === 0 ? "Primary image" : `Image ${index + 1}`}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => remove(index)} disabled={disabled || compressing} aria-label={`Remove image ${index + 1}`}>
                  <Trash2 aria-hidden /> Remove
                </Button>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No room images selected.</div>
      )}

      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => void addFiles(Array.from(event.target.files ?? []))}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={disabled || compressing || images.length >= ROOM_IMAGE_MAX_COUNT}>
          {compressing ? <LoaderCircle className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
          {compressing ? "Compressing…" : "Add images"}
        </Button>
        <p className="text-sm text-muted-foreground">JPEG, PNG, or WebP; maximum 2 MB per source image. Images are compressed automatically.</p>
      </div>
    </section>
  );
}
