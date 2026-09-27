import {
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Eye,
  Plus,
  Repeat2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Recurring Reservations Guide",
  description: "Staff how-to guide for every supported recurring room reservation schedule.",
};

type GuideField = {
  label: string;
  value: string;
};

type Scenario = {
  id: string;
  title: string;
  option: string;
  summary: string;
  icon: LucideIcon;
  fields: GuideField[];
  examples: string[];
  note?: string;
};

const SCENARIOS: readonly Scenario[] = [
  {
    id: "every-day",
    title: "Every day",
    option: "Every X days",
    summary: "Use this for a reservation that happens on consecutive calendar days, including weekends.",
    icon: CalendarDays,
    fields: [
      { label: "Repeats", value: "Every X days" },
      { label: "Every X days", value: "1" },
    ],
    examples: [
      "Start date: October 5, 2026 → October 5, 6, 7, 8…",
      "A week-long conference, daily prayer meeting, or multi-day training session.",
    ],
  },
  {
    id: "every-x-days",
    title: "Every few days",
    option: "Every X days",
    summary: "Use this when the spacing is measured in calendar days instead of named weekdays.",
    icon: Repeat2,
    fields: [
      { label: "Repeats", value: "Every X days" },
      { label: "Every X days", value: "Enter 2–365" },
    ],
    examples: [
      "Every 3 days starting October 5, 2026 → October 5, 8, 11, 14…",
      "Every other day → enter 2. Every two weeks by elapsed days → enter 14.",
    ],
    note: "This counts weekends. For Monday through Friday only, choose Every weekday instead.",
  },
  {
    id: "weekdays",
    title: "Every weekday",
    option: "Every weekday",
    summary: "Use this for Monday–Friday reservations that should automatically skip Saturday and Sunday.",
    icon: CalendarCheck2,
    fields: [{ label: "Repeats", value: "Every weekday" }],
    examples: [
      "Start date: Friday, October 2, 2026 → Friday, then Monday, Tuesday, Wednesday…",
      "A weekday-only program, school activity, or office-hours schedule.",
    ],
    note: "If the start date is a weekend, the first occurrence is the following Monday.",
  },
  {
    id: "weekly",
    title: "Weekly on one or more days",
    option: "Weekly",
    summary: "Use this for named weekdays, including alternating-week schedules and multiple days in the same week.",
    icon: CalendarDays,
    fields: [
      { label: "Repeats", value: "Weekly" },
      { label: "Every X weeks", value: "Enter 1–52" },
      { label: "Repeat on", value: "Choose one or more weekdays" },
    ],
    examples: [
      "Every Saturday → enter 1 and select Sat.",
      "Every 2 weeks on Monday and Wednesday → enter 2 and select Mon + Wed.",
      "Every 4 weeks on Sunday → enter 4 and select Sun.",
    ],
    note: "The start date anchors the week pattern. Dates before the start date are never included, even when their weekday is selected.",
  },
  {
    id: "monthly-date",
    title: "Monthly on a calendar date",
    option: "Monthly on a date",
    summary: "Use this when the event happens on the same numbered day of a month.",
    icon: CalendarCheck2,
    fields: [
      { label: "Repeats", value: "Monthly on a date" },
      { label: "Every X months", value: "Enter 1–12" },
      { label: "Day of month", value: "Enter 1–31" },
    ],
    examples: [
      "Day 15 of every month → interval 1, day 15.",
      "Day 15 of every 3 months → interval 3, day 15.",
      "Quarterly on the 1st → interval 3, day 1.",
    ],
    note: "A month without that date is skipped. Day 31 skips shorter months rather than moving to the 30th or last day.",
  },
  {
    id: "monthly-weekday",
    title: "Monthly on a weekday position",
    option: "Monthly on a weekday",
    summary: "Use this for first, second, third, fourth, or last weekday patterns—including multiple weeks in one month.",
    icon: Sparkles,
    fields: [
      { label: "Repeats", value: "Monthly on a weekday" },
      { label: "Every X months", value: "Enter 1–12" },
      { label: "Day of week", value: "Choose the weekday" },
      { label: "Week of month", value: "First, Second, Third, Fourth, or Last" },
    ],
    examples: [
      "The last Friday of every month → Friday + Last.",
      "The second Saturday of every month → Saturday + Second.",
      "The second and fourth Saturdays → choose Second, select Add week of month, then choose Fourth.",
      "The first and third Tuesdays every 2 months → interval 2, Tuesday + First + Third.",
    ],
    note: "One weekday applies to every selected week. If Fourth and Last land on the same date, the system creates only one occurrence.",
  },
  {
    id: "yearly-date",
    title: "Yearly on a calendar date",
    option: "Yearly on a date",
    summary: "Use this for an annual event tied to a specific month and date.",
    icon: CalendarCheck2,
    fields: [
      { label: "Repeats", value: "Yearly on a date" },
      { label: "Month", value: "Choose January–December" },
      { label: "Day of month", value: "Enter 1–31" },
    ],
    examples: [
      "Every September 26 → September + day 26.",
      "Every December 25 → December + day 25.",
      "Every February 29 → February + day 29.",
    ],
    note: "Invalid dates are skipped. A February 29 schedule creates occurrences only in leap years.",
  },
  {
    id: "yearly-weekday",
    title: "Yearly on a weekday position",
    option: "Yearly on a weekday",
    summary: "Use this for an annual event defined by a weekday within a particular month.",
    icon: CalendarDays,
    fields: [
      { label: "Repeats", value: "Yearly on a weekday" },
      { label: "Month", value: "Choose January–December" },
      { label: "Day of week", value: "Choose Sunday–Saturday" },
      { label: "Week of month", value: "First, Second, Third, Fourth, or Last" },
    ],
    examples: [
      "The first Monday of May → May + Monday + First.",
      "The fourth Thursday of November → November + Thursday + Fourth.",
      "The last Friday of December → December + Friday + Last.",
    ],
  },
] as const;

function FieldSummary({ fields }: { fields: readonly GuideField[] }) {
  return (
    <dl className="grid gap-2 rounded-lg bg-muted/55 p-3 text-sm sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label} className="min-w-0">
          <dt className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{field.label}</dt>
          <dd className="mt-0.5 font-medium">{field.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ScenarioCard({ scenario, number }: { scenario: Scenario; number: number }) {
  const Icon = scenario.icon;
  return (
    <article id={scenario.id} className="scroll-mt-24 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Scenario {number}</span>
            <Badge variant="secondary">{scenario.option}</Badge>
          </div>
          <h3 className="mt-1 text-lg font-semibold">{scenario.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{scenario.summary}</p>
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div>
          <h4 className="mb-2 text-sm font-semibold">Set these fields</h4>
          <FieldSummary fields={scenario.fields} />
        </div>
        <div>
          <h4 className="mb-2 text-sm font-semibold">Examples</h4>
          <ul className="space-y-2 text-sm">
            {scenario.examples.map((example) => (
              <li key={example} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success-soft-foreground" aria-hidden />
                <span>{example}</span>
              </li>
            ))}
          </ul>
        </div>
        {scenario.note ? (
          <div className="flex gap-2 rounded-lg border border-info-soft-border bg-info-soft p-3 text-sm text-info-soft-foreground">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>{scenario.note}</p>
          </div>
        ) : null}
      </div>
    </article>
  );
}

export default function RecurringReservationsGuidePage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Recurring Reservations How-To Guide"
        description="Choose the schedule that matches the ministry's need, follow the field examples, preview every date, and then create the series."
        actions={
          <Button asChild>
            <Link href="/admin/reservations/new#recurrence">
              <Plus data-icon="inline-start" aria-hidden />
              Create recurring reservation
            </Link>
          </Button>
        }
      />

      <Alert className="border-info-soft-border bg-info-soft text-info-soft-foreground">
        <BookOpenCheck aria-hidden />
        <AlertTitle>For Admins and Super Admins</AlertTitle>
        <AlertDescription className="text-info-soft-foreground/90">
          Recurring schedules are created from <strong>Reservations → New reservation</strong>. Guests cannot create a
          series themselves; their requests appear under <strong>Recurring Requests</strong> for staff follow-up.
        </AlertDescription>
      </Alert>

      <section aria-labelledby="workflow-heading" className="space-y-4">
        <div>
          <h2 id="workflow-heading" className="text-xl font-semibold">The same four steps for every schedule</h2>
          <p className="mt-1 text-sm text-muted-foreground">The start date is the earliest eligible date—not a promise that every rule will use that exact day.</p>
        </div>
        <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: CalendarDays, title: "Choose room and time", text: "Select the room, start date, start time, and end time first." },
            { icon: Repeat2, title: "Choose the rule", text: "Open Repeats and enter the interval, weekdays, month, or week position." },
            { icon: Eye, title: "Preview the schedule", text: "Review the series boundaries, available dates, and any conflicts before saving." },
            { icon: CalendarCheck2, title: "Create the series", text: "Confirm the requester details and select Create recurring series." },
          ].map((step, index) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="rounded-xl border bg-card p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{index + 1}</span>
                  <Icon className="size-5 text-primary" aria-hidden />
                </div>
                <h3 className="mt-3 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.text}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="chooser-heading" className="space-y-4">
        <div>
          <h2 id="chooser-heading" className="text-xl font-semibold">Which schedule should I choose?</h2>
          <p className="mt-1 text-sm text-muted-foreground">Select a scenario to jump to its setup and examples.</p>
        </div>
        <nav aria-label="Recurring schedule examples" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {SCENARIOS.map((scenario) => {
            const Icon = scenario.icon;
            return (
              <Link
                key={scenario.id}
                href={`#${scenario.id}`}
                className="group flex min-h-14 items-center gap-3 rounded-xl border bg-card px-3 py-2 text-sm font-medium transition-colors hover:border-ring hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Icon className="size-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">{scenario.title}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
              </Link>
            );
          })}
        </nav>
      </section>

      <section aria-labelledby="scenarios-heading" className="space-y-4">
        <div>
          <h2 id="scenarios-heading" className="text-xl font-semibold">All recurring scenarios</h2>
          <p className="mt-1 text-sm text-muted-foreground">The field names below match the New reservation screen.</p>
        </div>
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {SCENARIOS.map((scenario, index) => (
            <ScenarioCard key={scenario.id} scenario={scenario} number={index + 1} />
          ))}
        </div>
      </section>

      <section aria-labelledby="limits-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-warning-soft text-warning-soft-foreground">
            <Clock3 className="size-5" aria-hidden />
          </span>
          <div>
            <h2 id="limits-heading" className="text-xl font-semibold">End dates, limits, and conflicts</h2>
            <p className="mt-1 text-sm text-muted-foreground">These rules apply to every scenario above.</p>
          </div>
        </div>
        <ul className="grid gap-3 text-sm md:grid-cols-2">
          <li className="rounded-lg bg-muted/55 p-3"><strong>Optional end date:</strong> Set an end date when the ministry has a known final meeting. It is inclusive.</li>
          <li className="rounded-lg bg-muted/55 p-3"><strong>Automatic limit:</strong> Without an end date, the series stops at the earlier of one year or 50 occurrences.</li>
          <li className="rounded-lg bg-muted/55 p-3"><strong>Room booking window:</strong> Only dates currently allowed by the room are created now. Later dates are added automatically as they become bookable.</li>
          <li className="rounded-lg bg-muted/55 p-3"><strong>Conflicts at creation:</strong> If any date currently being created conflicts, the whole initial series is stopped so you can resolve it first.</li>
          <li className="rounded-lg bg-muted/55 p-3"><strong>Future conflicts:</strong> A later conflicting date is recorded as an exception; the system does not overwrite another reservation.</li>
          <li className="rounded-lg bg-muted/55 p-3"><strong>Local time stays local:</strong> A 2:00 PM series remains at 2:00 PM across daylight-saving time changes.</li>
        </ul>
      </section>

      <section aria-labelledby="after-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 id="after-heading" className="text-xl font-semibold">After the series is created</h2>
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <div className="rounded-lg border p-3"><h3 className="font-semibold">Change one occurrence</h3><p className="mt-1 text-muted-foreground">Open that reservation and edit or cancel it. The other occurrences stay unchanged.</p></div>
          <div className="rounded-lg border p-3"><h3 className="font-semibold">Stop future dates</h3><p className="mt-1 text-muted-foreground">Open the series and choose End series. Existing reservations remain in the calendar.</p></div>
          <div className="rounded-lg border p-3"><h3 className="font-semibold">Change the whole pattern</h3><p className="mt-1 text-muted-foreground">End the old series, then create a new one. Bulk editing a live series is intentionally not supported.</p></div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary p-4 text-primary-foreground sm:p-6">
        <div>
          <p className="font-semibold">Ready to build the schedule?</p>
          <p className="text-sm text-primary-foreground/80">Preview the dates before selecting Create recurring series.</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/admin/reservations/new#recurrence">
            Create recurring reservation
            <ArrowRight data-icon="inline-end" aria-hidden />
          </Link>
        </Button>
      </div>
    </div>
  );
}
