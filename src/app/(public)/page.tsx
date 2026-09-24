import {
  ArrowRight,
  BadgeCheck,
  CalendarRange,
  CalendarSearch,
  ClipboardPen,
  Mail,
  SendHorizontal,
  UserRoundCheck,
  UsersRound,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand";
import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { RoomCard } from "@/components/rooms/room-card";
import { Button } from "@/components/ui/button";
import { loadCatalog } from "@/lib/data/catalog";
import { site } from "@/lib/site";

export const revalidate = 300;

const STEPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: CalendarSearch,
    title: "Choose a room and time",
    body: "Pick a room, then an available date and time. Each room's rules are shown up front.",
  },
  {
    icon: ClipboardPen,
    title: "Tell us about it",
    body: "Your name, contact details, ministry, purpose, and how many people will attend.",
  },
  {
    icon: SendHorizontal,
    title: "Review and submit",
    body: "Some rooms are confirmed instantly. Others are reviewed by church staff first.",
  },
];

const GOOD_TO_KNOW: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: UserRoundCheck,
    title: "No account needed",
    body: "Anyone reserving for a Stonehill ministry or group can book without signing up.",
  },
  {
    icon: BadgeCheck,
    title: "Instant or reviewed",
    body: "Every room says whether it's confirmed right away or needs approval, before you book.",
  },
  {
    icon: UsersRound,
    title: "Room capacity",
    body: "Each room lists how many people it holds, and we'll let you know if your group may be too large.",
  },
  {
    icon: UtensilsCrossed,
    title: "Food & drinks policy",
    body: "See whether food and drinks are allowed in a room before you reserve it.",
  },
  {
    icon: CalendarRange,
    title: "How far ahead",
    body: "Each room shows how far in advance it can be reserved.",
  },
  {
    icon: Mail,
    title: "Email updates",
    body: "You'll get a confirmation email with a secure link to view or cancel your reservation.",
  },
];

export default async function HomePage() {
  const catalog = await loadCatalog();

  return (
    <>
      <section className="relative isolate overflow-hidden bg-hero text-hero-foreground">
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--brand-gold)_22%,transparent),transparent_60%)]"
        />
        <div className="page-container grid gap-10 py-12 sm:py-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
          <div className="flex flex-col gap-6">
            <p className="text-sm font-semibold tracking-[0.16em] text-brand-gold uppercase">
              {site.churchName}
            </p>
            <h1 className="text-4xl leading-tight font-extrabold sm:text-5xl">
              Reserve a room for your ministry
            </h1>
            <p className="max-w-xl text-lg text-hero-foreground/85">{site.tagline}</p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="bg-highlight text-highlight-foreground hover:bg-highlight/90 focus-visible:ring-hero-foreground/60"
              >
                <Link href="/reserve">
                  Reserve a Room
                  <ArrowRight data-icon="inline-end" aria-hidden />
                </Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="border-hero-foreground/35 bg-transparent text-hero-foreground hover:bg-hero-foreground/10 hover:text-hero-foreground dark:border-hero-foreground/35 dark:bg-transparent dark:hover:bg-hero-foreground/10"
              >
                <Link href="/availability">Check Availability</Link>
              </Button>
            </div>
          </div>
          <div className="order-first mx-auto w-full max-w-md lg:order-none lg:max-w-none">
            <div className="rounded-2xl border border-hero-foreground/10 bg-hero-foreground/[0.04] p-5 sm:p-8">
              <BrandLogo variant="on-dark" priority sizes="(min-width: 1024px) 32rem, 90vw" />
            </div>
          </div>
        </div>
      </section>

      <section aria-labelledby="rooms-heading" className="page-container py-14 sm:py-20">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="rooms-heading" className="text-2xl font-bold sm:text-3xl">
              Rooms
            </h2>
            <p className="mt-2 text-muted-foreground">Capacity and policies for each room, before you reserve.</p>
          </div>
          <Link
            href="/availability"
            className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-4 hover:underline"
          >
            See today&apos;s availability
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        </div>
        <div className="mt-8">
          {!catalog.ok ? (
            <CatalogUnavailable reason={catalog.reason} />
          ) : catalog.catalog.rooms.length === 0 ? (
            <p className="text-muted-foreground">Rooms will be listed here soon.</p>
          ) : (
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {catalog.catalog.rooms.map((room) => (
                <RoomCard key={room.id} room={room} />
              ))}
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="how-it-works" className="page-container py-14 sm:py-20">
        <div className="max-w-2xl">
          <h2 id="how-it-works" className="text-2xl font-bold sm:text-3xl">
            How it works
          </h2>
          <p className="mt-2 text-muted-foreground">Three short steps — most people finish in a couple of minutes.</p>
        </div>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {STEPS.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="relative flex flex-col gap-3 rounded-xl border bg-card p-6 shadow-xs">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="text-sm font-semibold text-gold-text">Step {index + 1}</span>
              </div>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="good-to-know" className="border-y bg-card">
        <div className="page-container py-14 sm:py-20">
          <h2 id="good-to-know" className="text-2xl font-bold sm:text-3xl">
            Good to know
          </h2>
          <ul className="mt-8 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {GOOD_TO_KNOW.map(({ icon: Icon, title, body }) => (
              <li key={title} className="flex gap-4">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                  <Icon className="size-5" aria-hidden />
                </span>
                <div>
                  <h3 className="font-semibold">{title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="page-container py-14 text-center sm:py-16">
        <h2 className="text-2xl font-bold">Ready to reserve?</h2>
        <p className="mx-auto mt-2 max-w-md text-muted-foreground">
          Find a room that fits your group and pick a time that works.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/reserve">Reserve a Room</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/rooms">Browse Rooms</Link>
          </Button>
        </div>
      </section>
    </>
  );
}
