"use client";

import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { setRoomImageAction } from "@/app/admin/(portal)/(super)/actions";
import { RoomImage } from "@/components/rooms/room-image";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Uploads straight from the browser to the `room-images` bucket (Storage RLS allows
 * Super Admins only), then records the path through an audited, role-checked action.
 */
export function RoomPhoto({ roomId, roomName, imageUrl }: { roomId: string; roomName: string; imageUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(imageUrl);
  const [pending, startTransition] = useTransition();

  function upload(file: File) {
    const ext = TYPES[file.type];
    if (!ext) return toast.error("Please choose a JPEG, PNG or WebP image.");
    if (file.size > MAX_BYTES) return toast.error("Please choose an image under 5 MB.");

    startTransition(async () => {
      const path = `rooms/${roomId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await getSupabaseBrowserClient().storage.from("room-images").upload(path, file, {
        contentType: file.type,
        cacheControl: "31536000",
        upsert: false,
      });
      if (error) {
        console.error("[room-photo] upload failed", error.message);
        toast.error("The photo couldn't be uploaded. Please try again.");
        return;
      }
      const result = await setRoomImageAction(roomId, path);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPreview(URL.createObjectURL(file));
      toast.success(result.message);
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await setRoomImageAction(roomId, null);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPreview(null);
      toast.success(result.message);
    });
  }

  return (
    <section aria-labelledby="photo-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
      <h2 id="photo-heading" className="text-lg font-semibold">
        Photo
      </h2>
      <div className="max-w-md overflow-hidden rounded-lg border">
        <RoomImage src={preview} name={roomName} sizes="28rem" />
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <ImagePlus data-icon="inline-start" aria-hidden />}
          {pending ? "Uploading…" : preview ? "Replace photo" : "Upload photo"}
        </Button>
        {preview ? (
          <Button type="button" variant="ghost" onClick={remove} disabled={pending}>
            <Trash2 data-icon="inline-start" aria-hidden />
            Remove
          </Button>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">JPEG, PNG or WebP, up to 5 MB. A landscape photo works best.</p>
    </section>
  );
}
