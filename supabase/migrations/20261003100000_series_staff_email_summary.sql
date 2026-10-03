-- Reserve-A-Room · One staff email per recurring series, not one per occurrence.
--
-- The 20260926130000 trigger emails opted-in staff for every approved reservation insert.
-- A recurring series inserts up to 50 ordinary approved reservations at once, so each
-- staff member received one "New reservation" email per occurrence, and the unsent
-- remainder drained through the daily outbox sweep (50 per run) over the following days.
--
-- From now on:
--   * Occurrences created by a series (including the rolling daily top-ups) queue no
--     per-reservation "new reservation" staff email.
--   * Creating the series queues exactly one summary email per staff recipient through the
--     idempotent system-email outbox.
--   * Cancellation alerts are unchanged.

create or replace function private.queue_staff_reservation_email_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'approved' and new.series_id is null then
    perform private.queue_staff_emails(new.id, 'admin_reservation_created');
  elsif tg_op = 'UPDATE'
        and old.status is distinct from new.status
        and new.status = 'cancelled'
        and not new.cancelled_by_requester then
    perform private.queue_staff_emails(new.id, 'admin_reservation_cancelled');
  end if;
  return new;
end;
$$;

create function private.queue_series_staff_emails()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Rendered at delivery time, after the series' occurrences exist. The unique key on
  -- (event, entity, recipient) makes a repeated insert path harmless.
  perform private.queue_system_email(recipient, 'recurring_series_staff_created', 'reservation_series', new.id)
  from private.staff_email_recipients() as recipient;
  return new;
end;
$$;

create trigger reservation_series_queue_staff_emails
  after insert on public.reservation_series
  for each row execute function private.queue_series_staff_emails();

revoke execute on function private.queue_series_staff_emails() from public, anon, authenticated;
revoke execute on function private.queue_staff_reservation_email_events() from public, anon, authenticated;

-- Stop the backlog already in the outbox: per-occurrence staff emails that were queued but
-- never sent. Emails that were already sent stay in the log as history.
delete from public.email_logs e
using public.reservations r
where e.reservation_id = r.id
  and r.series_id is not null
  and e.event_type = 'admin_reservation_created'
  and e.status in ('queued', 'sending');
