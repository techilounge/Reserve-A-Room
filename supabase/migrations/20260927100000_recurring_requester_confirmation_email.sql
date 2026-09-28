-- Reserve-A-Room · Durable requester acknowledgement for recurring-date requests.

create function private.queue_recurring_request_requester_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.queue_system_email(
    new.requester_email,
    'recurring_request_received',
    'recurring_request',
    new.id
  );
  return new;
end;
$$;

create trigger recurring_requests_queue_requester_email
  after insert on public.recurring_reservation_requests
  for each row execute function private.queue_recurring_request_requester_email();

-- Extend the generic system-email context with recurring request details. The trigger
-- starts with future inserts only, so applying this migration does not email historical requests.
create or replace function public.system_email_context(p_email_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'email_id', e.id,
    'recipient', e.recipient,
    'event_type', e.event_type,
    'attempt_count', e.attempt_count,
    'entity_type', e.entity_type,
    'entity_id', e.entity_id,
    'payload', e.payload,
    'settings', to_jsonb(settings),
    'series', case when series.id is not null then to_jsonb(series) end,
    'recurring_request', case when request_row.id is not null then to_jsonb(request_row) end,
    'room', case when room.id is not null then to_jsonb(room) end,
    'ministry_name', coalesce(ministry.name, series.other_ministry_name),
    'user', case when profile.id is not null then jsonb_build_object(
      'id', profile.id,
      'full_name', profile.full_name,
      'email', profile.email,
      'role', profile.role,
      'invitation_accepted_at', profile.invitation_accepted_at
    ) end,
    'occurrences', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'reference_code', r.reference_code,
        'occurrence_date', r.occurrence_date,
        'start_at', r.start_at,
        'end_at', r.end_at
      ) order by r.occurrence_date)
      from public.reservations r
      where r.series_id = series.id
    ), '[]'::jsonb)
  )
  from public.system_email_logs e
  cross join public.app_settings settings
  left join public.reservation_series series
    on e.entity_type = 'reservation_series' and series.id = e.entity_id
  left join public.recurring_reservation_requests request_row
    on e.entity_type = 'recurring_request' and request_row.id = e.entity_id
  left join public.rooms room on room.id = coalesce(series.room_id, request_row.room_id)
  left join public.ministries ministry on ministry.id = series.ministry_id
  left join public.profiles profile on e.entity_type = 'user' and profile.id = e.entity_id
  where e.id = p_email_id and settings.id;
$$;

revoke execute on function private.queue_recurring_request_requester_email() from public, anon, authenticated;
revoke execute on function public.system_email_context(uuid) from public, anon, authenticated;
grant execute on function public.system_email_context(uuid) to service_role;
