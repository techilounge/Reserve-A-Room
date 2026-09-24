"use client";

import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCompactDate, type LocalDate } from "@/lib/datetime";
import { cn } from "@/lib/utils";

/** LocalDate ⇄ Date at local midnight in the browser (day-picker works in browser time). */
function toPickerDate(value: LocalDate): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fromPickerDate(value: Date): LocalDate {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

/**
 * Date picker whose selectable range is bounded by `minDate`/`maxDate` (e.g. today and
 * the room's advance-booking horizon). Dates outside the range cannot be chosen.
 */
export function DatePicker({
  id,
  name,
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = "Choose a date",
  invalid,
  describedBy,
  className,
}: {
  id?: string;
  name?: string;
  value: LocalDate | null;
  onChange: (value: LocalDate) => void;
  minDate: LocalDate;
  maxDate: LocalDate;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? toPickerDate(value) : undefined;
  const min = toPickerDate(minDate);
  const max = toPickerDate(maxDate);

  return (
    <>
      {name ? <input type="hidden" name={name} value={value ?? ""} /> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn("w-full min-w-0 flex-1 shrink justify-start font-normal", !value && "text-muted-foreground", className)}
          >
            <CalendarDays data-icon="inline-start" aria-hidden />
            <span className="truncate">{value ? formatCompactDate(value) : placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected ?? min}
            startMonth={min}
            endMonth={max}
            disabled={[{ before: min }, { after: max }]}
            onSelect={(date) => {
              if (!date) return;
              onChange(fromPickerDate(date));
              setOpen(false);
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </>
  );
}
