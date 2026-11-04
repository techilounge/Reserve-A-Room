-- Phase 6 foundation only: immutable approval identity and terminal history.
-- No API role can create, modify or view these rows directly.
alter table public.calendar_event_submissions add constraint calendar_event_submissions_event_id_id_key unique(event_id,id);

create table public.calendar_event_commitments (
  id uuid primary key default gen_random_uuid(),
  approval_order bigint generated always as identity,
  event_id uuid not null references public.calendar_events(id),
  submission_id uuid not null,
  state text not null default 'active' check (state in ('active','replaced','cancelled')),
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  close_reason text,
  foreign key(event_id,submission_id) references public.calendar_event_submissions(event_id,id),
  check ((state='active' and closed_by is null and closed_at is null and close_reason is null)
    or (state in ('replaced','cancelled') and closed_by is not null and closed_at is not null
      and char_length(btrim(coalesce(close_reason,''))) between 3 and 2000))
);
create unique index calendar_event_commitments_one_active on public.calendar_event_commitments(event_id) where state='active';
create index calendar_event_commitments_submission on public.calendar_event_commitments(submission_id);
alter table public.calendar_event_commitments enable row level security;
revoke all on public.calendar_event_commitments from public, anon, authenticated, service_role;

create function private.guard_calendar_commitment_history() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' or old.state<>'active' or new.state not in ('replaced','cancelled')
    or (new.id,new.approval_order,new.event_id,new.submission_id,new.approved_by,new.approved_at)
      is distinct from (old.id,old.approval_order,old.event_id,old.submission_id,old.approved_by,old.approved_at) then
    raise exception 'Calendar commitment history cannot be changed.' using errcode='RAR09';
  end if;
  if exists (select 1 from public.reservations r where r.calendar_commitment_id=old.id
      and r.status in ('pending','approved') and r.start_at>now())
    or exists (select 1 from public.calendar_resource_allocations a
      join public.calendar_submission_occurrences o on o.id=a.submission_occurrence_id
      where o.submission_id=old.submission_id and a.status='confirmed' and a.occupancy_start>now()) then
    raise exception 'Release future room and resource commitments before closing this approval.' using errcode='RAR09';
  end if;
  return new;
end;
$$;
create trigger calendar_commitment_history before update or delete on public.calendar_event_commitments
  for each row execute function private.guard_calendar_commitment_history();
revoke execute on function private.guard_calendar_commitment_history() from public, anon, authenticated, service_role;

alter table public.reservations add column calendar_commitment_id uuid references public.calendar_event_commitments(id);
alter table public.reservations add constraint reservations_calendar_linkage_check check (
  (calendar_submission_occurrence_id is null) = (calendar_commitment_id is null));
create unique index reservations_calendar_commitment_occurrence_room
  on public.reservations(calendar_commitment_id,calendar_submission_occurrence_id,room_id)
  where calendar_commitment_id is not null;
