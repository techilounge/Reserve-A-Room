-- A focused guest request path for schedules that require staff-created recurrence.

create table public.recurring_reservation_requests (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null unique,
  status text not null default 'submitted',
  room_id uuid not null references public.rooms (id),
  preferred_start_date date not null,
  local_start_time time not null,
  local_end_time time not null,
  recurrence_description text not null,
  requester_first_name text not null,
  requester_last_name text not null,
  requester_email text not null,
  requester_phone text not null,
  purpose text not null,
  estimated_attendance integer not null,
  requester_notes text,
  privacy_accepted_at timestamptz not null,
  terms_accepted_at timestamptz not null,
  privacy_version text not null,
  terms_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_requests_reference_format check (reference_code ~ '^RRR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{4}$'),
  constraint recurring_requests_status_valid check (status in ('submitted', 'contacted', 'closed')),
  constraint recurring_requests_time_order check (local_end_time > local_start_time),
  constraint recurring_requests_recurrence_length check (char_length(btrim(recurrence_description)) between 3 and 1000),
  constraint recurring_requests_first_name_length check (char_length(btrim(requester_first_name)) between 1 and 80),
  constraint recurring_requests_last_name_length check (char_length(btrim(requester_last_name)) between 1 and 80),
  constraint recurring_requests_email_valid check (private.is_valid_email(requester_email)),
  constraint recurring_requests_phone_valid check (requester_phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint recurring_requests_purpose_length check (char_length(btrim(purpose)) between 1 and 500),
  constraint recurring_requests_attendance_range check (estimated_attendance between 1 and 10000),
  constraint recurring_requests_notes_length check (requester_notes is null or char_length(requester_notes) <= 1000)
);

create index recurring_requests_created_idx on public.recurring_reservation_requests (created_at desc);
create index recurring_requests_status_created_idx on public.recurring_reservation_requests (status, created_at desc);

create trigger recurring_requests_set_updated_at
  before update on public.recurring_reservation_requests
  for each row execute function private.set_updated_at();

alter table public.recurring_reservation_requests enable row level security;
grant select on public.recurring_reservation_requests to authenticated;
create policy recurring_requests_read_staff on public.recurring_reservation_requests
  for select to authenticated using ((select private.is_staff()));

alter table public.notifications
  add column recurring_request_id uuid references public.recurring_reservation_requests (id) on delete set null;
create index notifications_recurring_request_idx on public.notifications (recurring_request_id);
alter table public.notifications drop constraint notifications_type_valid;
alter table public.notifications add constraint notifications_type_valid check (type in (
  'reservation_pending', 'reservation_cancelled_by_requester', 'reservation_modified',
  'reservation_approved', 'reservation_declined', 'email_failed', 'recurring_request_received'
));

drop function public.my_notifications(boolean, integer, integer);
create function public.my_notifications(p_unread_only boolean default false, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, type text, title text, message text, reservation_id uuid, recurring_request_id uuid,
  read_at timestamptz, created_at timestamptz, total_count bigint
)
language sql
stable
set search_path = ''
as $$
  select n.id, n.type, n.title, n.message, n.reservation_id, n.recurring_request_id,
         n.read_at, n.created_at, count(*) over ()
  from public.notifications n
  where n.user_id = (select auth.uid()) and (not p_unread_only or n.read_at is null)
  order by n.created_at desc, n.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function private.generate_recurring_request_reference()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  random_bytes bytea := pg_catalog.uuid_send(pg_catalog.gen_random_uuid());
  suffix text := '';
  i integer;
begin
  for i in 0..3 loop
    suffix := suffix || substr(alphabet, (get_byte(random_bytes, i) % 32) + 1, 1);
  end loop;
  return 'RRR-' || to_char(pg_catalog.now() at time zone (select timezone from public.app_settings where id), 'YYYYMMDD') || '-' || suffix;
end;
$$;

create function public.create_recurring_reservation_request(
  p_room_id uuid,
  p_preferred_start_date date,
  p_local_start_time time,
  p_local_end_time time,
  p_recurrence_description text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_purpose text,
  p_estimated_attendance integer,
  p_privacy_accepted boolean,
  p_terms_accepted boolean,
  p_privacy_version text,
  p_terms_version text,
  p_requester_notes text default null
)
returns table (id uuid, reference_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_reference text;
  v_room_name text;
  v_attempt integer := 0;
begin
  if not p_privacy_accepted or not p_terms_accepted then
    raise exception 'Privacy and Terms acceptance is required.' using errcode = 'RAR10';
  end if;
  select r.name into v_room_name from public.rooms r where r.id = p_room_id and r.active;
  if not found then
    raise exception 'Room not found.' using errcode = 'RAR08';
  end if;

  loop
    v_attempt := v_attempt + 1;
    v_reference := private.generate_recurring_request_reference();
    begin
      insert into public.recurring_reservation_requests (
        reference_code, room_id, preferred_start_date, local_start_time, local_end_time,
        recurrence_description, requester_first_name, requester_last_name, requester_email,
        requester_phone, purpose, estimated_attendance, requester_notes,
        privacy_accepted_at, terms_accepted_at, privacy_version, terms_version
      ) values (
        v_reference, p_room_id, p_preferred_start_date, p_local_start_time, p_local_end_time,
        btrim(p_recurrence_description), btrim(p_first_name), btrim(p_last_name), lower(btrim(p_email)),
        p_phone, btrim(p_purpose), p_estimated_attendance, nullif(btrim(p_requester_notes), ''),
        now(), now(), p_privacy_version, p_terms_version
      ) returning recurring_reservation_requests.id into v_id;
      exit;
    exception when unique_violation then
      if v_attempt >= 5 then raise; end if;
    end;
  end loop;

  insert into public.notifications (user_id, type, title, message, recurring_request_id)
  select p.id, 'recurring_request_received', 'Recurring request: ' || v_room_name,
         btrim(p_first_name) || ' ' || btrim(p_last_name) || ' submitted ' || v_reference || '.', v_id
  from public.profiles p where p.active;

  perform private.write_audit(
    'recurring_request.created', 'recurring_request', v_id::text,
    jsonb_build_object('reference_code', v_reference, 'room_id', p_room_id), 'guest'
  );

  return query select v_id, v_reference;
end;
$$;

revoke execute on function private.generate_recurring_request_reference() from public, anon, authenticated;
revoke execute on function public.create_recurring_reservation_request(uuid, date, time, time, text, text, text, text, text, text, integer, boolean, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.create_recurring_reservation_request(uuid, date, time, time, text, text, text, text, text, text, integer, boolean, boolean, text, text, text) to service_role;

revoke execute on function public.my_notifications(boolean, integer, integer) from public, anon;
grant execute on function public.my_notifications(boolean, integer, integer) to authenticated, service_role;
