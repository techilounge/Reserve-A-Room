-- Reserve-A-Room · Email outbox (ADR-10).
-- email_logs rows are inserted as 'queued' inside the reservation transaction. The server
-- claims them, renders + sends via Resend, and records the result. A failed email never
-- affects the reservation. Claim/complete/context are service-role only.

-- Claims up to p_limit queued emails (or ones stuck in 'sending' for 10+ minutes),
-- marking them 'sending'. SKIP LOCKED lets concurrent workers never double-send.
create function public.claim_emails(p_limit integer default 20, p_reservation_id uuid default null)
returns setof uuid
language sql
security definer
set search_path = ''
as $$
  update public.email_logs e
  set status = 'sending', attempt_count = e.attempt_count + 1, last_attempt_at = now()
  where e.id in (
    select x.id from public.email_logs x
    where (x.status = 'queued' or (x.status = 'sending' and x.last_attempt_at < now() - interval '10 minutes'))
      and x.attempt_count < 5
      and (p_reservation_id is null or x.reservation_id = p_reservation_id)
    order by x.created_at
    limit least(greatest(p_limit, 1), 100)
    for update skip locked
  )
  returning e.id;
$$;

-- Everything a template needs, in one row. Includes the guest link seed (never exposed
-- outside trusted server code).
create function public.email_context(p_email_id uuid)
returns table (
  email_id uuid,
  recipient text,
  event_type text,
  attempt_count integer,
  reservation_id uuid,
  reference_code text,
  status public.reservation_status,
  room_name text,
  room_capacity integer,
  start_at timestamptz,
  end_at timestamptz,
  requester_first_name text,
  requester_last_name text,
  requester_email text,
  requester_phone text,
  ministry_name text,
  purpose text,
  estimated_attendance integer,
  setup_requirements text,
  requester_notes text,
  requester_message text,
  food_drinks_allowed boolean,
  approval_required boolean,
  cancelled_by_requester boolean,
  guest_token_seed text,
  church_name text,
  app_name text,
  timezone text,
  contact_email text,
  contact_phone text,
  email_sender_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.recipient, e.event_type, e.attempt_count, r.id, r.reference_code, r.status, rm.name, rm.capacity,
         r.start_at, r.end_at, r.requester_first_name, r.requester_last_name, r.requester_email, r.requester_phone,
         coalesce(m.name, r.other_ministry_name), r.purpose, r.estimated_attendance, r.setup_requirements,
         r.requester_notes, r.requester_message, r.food_drinks_allowed_at_submission, r.approval_required_at_submission,
         r.cancelled_by_requester, '\x' || encode(r.guest_token_seed, 'hex'),
         s.church_name, s.app_name, s.timezone, s.contact_email, s.contact_phone, s.email_sender_name
  from public.email_logs e
  join public.reservations r on r.id = e.reservation_id
  join public.rooms rm on rm.id = r.room_id
  left join public.ministries m on m.id = r.ministry_id
  cross join public.app_settings s
  where e.id = p_email_id and s.id;
$$;

-- Records the outcome. On a requester email failure, staff get an in-app alert.
create function public.complete_email(
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

  if p_status = 'failed' and v_email.event_type not in ('admin_new_request', 'admin_reservation_cancelled') then
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

-- Staff: put a failed (or skipped) email back in the queue.
create function public.retry_email(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_staff();
  update public.email_logs
  set status = 'queued', attempt_count = 0, error_message = null
  where id = p_id and status in ('failed', 'skipped');
  if not found then
    raise exception 'Only failed emails can be retried.' using errcode = 'RAR05';
  end if;
  perform private.write_audit('email.retried', 'email', p_id::text, '{}'::jsonb);
end;
$$;

revoke execute on function public.claim_emails(integer, uuid) from public, anon, authenticated;
revoke execute on function public.email_context(uuid) from public, anon, authenticated;
revoke execute on function public.complete_email(uuid, public.email_status, text, text) from public, anon, authenticated;
revoke execute on function public.retry_email(uuid) from public, anon;
grant execute on function public.claim_emails(integer, uuid) to service_role;
grant execute on function public.email_context(uuid) to service_role;
grant execute on function public.complete_email(uuid, public.email_status, text, text) to service_role;
grant execute on function public.retry_email(uuid) to authenticated, service_role;
