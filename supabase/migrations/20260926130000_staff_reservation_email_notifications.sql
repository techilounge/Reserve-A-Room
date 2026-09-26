-- Email opted-in Admins/Super Admins (and configured extra recipients) for every
-- confirmed reservation and every cancellation. Existing pending-request and
-- requester-cancellation paths already queue their staff messages explicitly.

alter table public.email_logs drop constraint email_logs_event_type_valid;
alter table public.email_logs add constraint email_logs_event_type_valid check (event_type in (
  'request_submitted', 'admin_new_request', 'admin_reservation_created',
  'reservation_confirmed', 'reservation_approved', 'reservation_declined',
  'reservation_modified', 'reservation_cancelled', 'admin_reservation_cancelled'
));

create function private.queue_staff_reservation_email_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and new.status = 'approved' then
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

create trigger reservations_queue_staff_email_events
  after insert or update of status on public.reservations
  for each row execute function private.queue_staff_reservation_email_events();

revoke execute on function private.queue_staff_reservation_email_events() from public, anon, authenticated;

-- Staff-recipient failures should stay in the delivery log without recursively
-- notifying every administrator that another administrator's alert failed.
create or replace function public.complete_email(
  p_id uuid,
  p_status public.email_status,
  p_provider_message_id text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email public.email_logs;
  v_ref text;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Invalid email status.' using errcode = 'RAR10';
  end if;
  update public.email_logs
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_message = case when p_status = 'failed' then left(p_error, 500) else null end,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id
  returning * into v_email;

  if p_status = 'failed'
     and v_email.event_type not in ('admin_new_request', 'admin_reservation_created', 'admin_reservation_cancelled') then
    select reference_code into v_ref from public.reservations where id = v_email.reservation_id;
    perform private.notify_staff(
      'email_failed',
      'Email not delivered: ' || coalesce(v_ref, 'reservation'),
      'An email to ' || v_email.recipient || ' could not be sent. Open the reservation to retry.',
      v_email.reservation_id
    );
  end if;
end;
$$;

revoke execute on function public.complete_email(uuid, public.email_status, text, text) from public, anon, authenticated;
grant execute on function public.complete_email(uuid, public.email_status, text, text) to service_role;
