"use client";

import { CircleCheck } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

import { RoomImage } from "./room-image";

export function RoomGallery({ roomName, imageUrls }: { roomName: string; imageUrls: string[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedImage = imageUrls[selectedIndex] ?? null;
  const hasMultipleImages = imageUrls.length > 1;

  return (
    <section className="space-y-3" aria-label={`${roomName} photo gallery`}>
      <div id="room-gallery-main-image">
        <RoomImage
          src={selectedImage}
          name={hasMultipleImages ? `${roomName}, image ${selectedIndex + 1} of ${imageUrls.length}` : roomName}
          priority
          sizes="(min-width: 1024px) 38rem, 100vw"
          className="rounded-xl border"
        />
      </div>

      {hasMultipleImages ? (
        <>
          <p className="sr-only" aria-live="polite">
            Showing image {selectedIndex + 1} of {imageUrls.length}.
          </p>
          <div className="grid grid-cols-4 gap-3" role="group" aria-label="Choose a room image">
            {imageUrls.map((imageUrl, index) => {
              const selected = index === selectedIndex;
              return (
                <button
                  key={imageUrl}
                  type="button"
                  aria-label={`Show image ${index + 1} of ${imageUrls.length}`}
                  aria-controls="room-gallery-main-image"
                  aria-pressed={selected}
                  onClick={() => setSelectedIndex(index)}
                  className={cn(
                    "relative cursor-pointer overflow-hidden rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-brand-gold hover:shadow-md focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-ring",
                    selected
                      ? "border-brand-gold ring-2 ring-brand-gold dark:ring-brand-gold/80"
                      : "border-border hover:ring-2 hover:ring-brand-gold/60",
                  )}
                >
                  <RoomImage
                    src={imageUrl}
                    name={`${roomName}, thumbnail ${index + 1}`}
                    sizes="(min-width: 1024px) 9rem, 22vw"
                  />
                  {selected ? (
                    <span className="absolute top-1.5 right-1.5 rounded-full bg-background/90 p-1 text-gold-text shadow-sm" aria-hidden>
                      <CircleCheck className="size-4" />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
