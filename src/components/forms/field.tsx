import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** ARIA wiring for an input rendered inside <Field>. */
export function fieldProps(id: string, error?: string, hasDescription = false) {
  const describedBy = [hasDescription ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy || undefined,
  } as const;
}

/** Label + control + optional hint + error message, with consistent spacing and ids. */
export function Field({
  id,
  label,
  required = false,
  optional = false,
  description,
  error,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  required?: boolean;
  optional?: boolean;
  description?: ReactNode;
  error?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={id} className="gap-1">
        {label}
        {required ? (
          <span className="text-destructive" aria-hidden>
            *
          </span>
        ) : null}
        {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
      </Label>
      {children}
      {description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
