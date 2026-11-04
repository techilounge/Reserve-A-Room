-- A cancelled occurrence is durable history, independent of mutable draft rows.
create table public.calendar_commitment_occurrence_cancellations (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.calendar_event_commitments(id),
  submission_occurrence_id uuid not null references public.calendar_submission_occurrences(id),
  logical_occurrence_id uuid not null,
  reason text not null check (char_length(btrim(reason)) between 3 and 2000),
  cancelled_by uuid not null references public.profiles(id),
  cancelled_at timestamptz not null default now(),
  copied_from uuid references public.calendar_commitment_occurrence_cancellations(id),
  unique(commitment_id,logical_occurrence_id)
);
alter table public.calendar_commitment_occurrence_cancellations enable row level security;
revoke all on public.calendar_commitment_occurrence_cancellations from public,anon,authenticated,service_role;

create function private.guard_calendar_occurrence_cancellation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then raise exception 'Cancelled occurrence history is immutable.' using errcode='RAR09'; end if;
  if not exists(select 1 from public.calendar_event_commitments c join public.calendar_submission_occurrences o on o.submission_id=c.submission_id
    where c.id=new.commitment_id and c.state='active' and o.id=new.submission_occurrence_id and o.logical_occurrence_id=new.logical_occurrence_id) then
    raise exception 'Occurrence does not belong to this commitment.' using errcode='RAR09'; end if;
  return new;
end;
$$;
create trigger calendar_occurrence_cancellation_guard before insert or update or delete on public.calendar_commitment_occurrence_cancellations
  for each row execute function private.guard_calendar_occurrence_cancellation();
revoke execute on function private.guard_calendar_occurrence_cancellation() from public,anon,authenticated,service_role;
