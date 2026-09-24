-- Reserve-A-Room · Core tables, constraints and indexes.

-- ---------------------------------------------------------------------------
-- profiles — administrative users only (guests never have a record)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null,
  role public.app_role not null default 'admin',
  active boolean not null default true,
  email_notifications boolean not null default true,
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_valid check (private.is_valid_email(email)),
  constraint profiles_full_name_length check (char_length(btrim(full_name)) between 1 and 120)
);
create unique index profiles_email_key on public.profiles (email);
create index profiles_role_active_idx on public.profiles (role) where active;

-- ---------------------------------------------------------------------------
-- app_settings — one typed row
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true,
  church_name text not null default 'Stonehill Seventh-day Adventist Church',
  app_name text not null default 'Reserve-A-Room',
  timezone text not null default 'America/Chicago',
  contact_email text,
  contact_phone text,
  booking_interval_minutes integer not null default 30,
  default_max_advance_value integer not null default 8,
  default_max_advance_unit public.advance_unit not null default 'week',
  min_lead_time_minutes integer not null default 0,
  bookable_day_start time not null default '06:00',
  bookable_day_end time not null default '22:00',
  allow_guest_cancellation boolean not null default true,
  extra_admin_notification_emails text[] not null default '{}',
  email_sender_name text not null default 'Stonehill Reserve-A-Room',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint app_settings_singleton check (id),
  constraint app_settings_church_name_length check (char_length(btrim(church_name)) between 1 and 200),
  constraint app_settings_app_name_length check (char_length(btrim(app_name)) between 1 and 100),
  constraint app_settings_timezone_valid check (private.is_valid_timezone(timezone)),
  constraint app_settings_contact_email_valid check (contact_email is null or private.is_valid_email(contact_email)),
  constraint app_settings_contact_phone_length check (contact_phone is null or char_length(contact_phone) <= 40),
  constraint app_settings_interval_valid check (booking_interval_minutes in (15, 30, 60)),
  constraint app_settings_default_advance_valid check (private.is_valid_advance(default_max_advance_value, default_max_advance_unit)),
  constraint app_settings_lead_time_range check (min_lead_time_minutes between 0 and 10080),
  constraint app_settings_day_window check (bookable_day_start < bookable_day_end),
  constraint app_settings_extra_emails_limit check (cardinality(extra_admin_notification_emails) <= 10),
  constraint app_settings_sender_name_length check (char_length(btrim(email_sender_name)) between 1 and 100)
);

-- ---------------------------------------------------------------------------
-- ministries — "Other / Not Listed" is represented on reservations, not here
-- ---------------------------------------------------------------------------
create table public.ministries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ministries_name_length check (char_length(btrim(name)) between 1 and 120)
);
create unique index ministries_name_key on public.ministries (lower(name));

-- ---------------------------------------------------------------------------
-- amenities + rooms
-- ---------------------------------------------------------------------------
create table public.amenities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Key into the UI's icon allowlist (validated by the app); null = generic icon.
  icon text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint amenities_name_length check (char_length(btrim(name)) between 1 and 60),
  constraint amenities_icon_format check (icon is null or icon ~ '^[a-z0-9-]{1,40}$')
);
create unique index amenities_name_key on public.amenities (lower(name));

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  location text,
  capacity integer not null,
  image_path text,
  active boolean not null default true,
  reservable boolean not null default true,
  unavailable_message text,
  approval_required boolean not null default true,
  -- Both null ⇒ the application default from app_settings applies.
  max_advance_value integer,
  max_advance_unit public.advance_unit,
  food_drinks_allowed boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_name_length check (char_length(btrim(name)) between 1 and 100),
  constraint rooms_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint rooms_description_length check (description is null or char_length(description) <= 2000),
  constraint rooms_location_length check (location is null or char_length(location) <= 200),
  constraint rooms_capacity_range check (capacity between 1 and 10000),
  constraint rooms_image_path_length check (image_path is null or char_length(image_path) <= 500),
  constraint rooms_unavailable_message_length check (unavailable_message is null or char_length(unavailable_message) <= 300),
  constraint rooms_max_advance_pair check ((max_advance_value is null) = (max_advance_unit is null)),
  constraint rooms_max_advance_valid check (max_advance_value is null or private.is_valid_advance(max_advance_value, max_advance_unit))
);
create unique index rooms_slug_key on public.rooms (slug);
create index rooms_listing_idx on public.rooms (sort_order, name) where active;

create table public.room_amenities (
  room_id uuid not null references public.rooms (id) on delete cascade,
  amenity_id uuid not null references public.amenities (id) on delete cascade,
  primary key (room_id, amenity_id)
);
create index room_amenities_amenity_idx on public.room_amenities (amenity_id);

-- ---------------------------------------------------------------------------
-- reservations
-- ---------------------------------------------------------------------------
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  reference_code text not null,
  status public.reservation_status not null,
  source public.reservation_source not null default 'guest',
  room_id uuid not null references public.rooms (id) on delete restrict,
  start_at timestamptz not null,
  end_at timestamptz not null,
  reservation_range tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,

  requester_first_name text not null,
  requester_last_name text not null,
  requester_email text not null,
  -- E.164, e.g. +15125550123. Formatted for display by the app.
  requester_phone text not null,
  ministry_id uuid references public.ministries (id) on delete restrict,
  other_ministry_name text,
  purpose text not null,
  estimated_attendance integer not null,
  setup_requirements text,
  requester_notes text,

  -- PRIVATE staff notes. Never shown to requesters.
  admin_notes text,
  -- Requester-visible message (decline/cancel reason).
  requester_message text,

  -- Policy snapshots: what the requester saw when booking (set by trigger).
  approval_required_at_submission boolean not null,
  food_drinks_allowed_at_submission boolean not null,
  room_capacity_at_submission integer not null,

  created_by_user_id uuid references public.profiles (id) on delete set null,
  approved_by uuid references public.profiles (id) on delete set null,
  approved_at timestamptz,
  declined_by uuid references public.profiles (id) on delete set null,
  declined_at timestamptz,
  cancelled_by_user_id uuid references public.profiles (id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by_requester boolean not null default false,

  -- sha256 of the guest management token. The token itself is never stored.
  guest_token_hash bytea not null,

  -- Lower-cased haystack for indexed admin search.
  search_text text generated always as (
    lower(
      reference_code || ' ' || requester_first_name || ' ' || requester_last_name || ' ' ||
      requester_email || ' ' || requester_phone || ' ' || purpose || ' ' ||
      coalesce(other_ministry_name, '')
    )
  ) stored,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint reservations_reference_format check (reference_code ~ '^RAR-[0-9]{8}-[0-9A-HJKMNP-TV-Z]{4}$'),
  constraint reservations_time_order check (end_at > start_at),
  constraint reservations_first_name_length check (char_length(btrim(requester_first_name)) between 1 and 80),
  constraint reservations_last_name_length check (char_length(btrim(requester_last_name)) between 1 and 80),
  constraint reservations_email_valid check (private.is_valid_email(requester_email)),
  constraint reservations_phone_e164 check (requester_phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint reservations_ministry_choice check ((ministry_id is null) <> (other_ministry_name is null)),
  constraint reservations_other_ministry_length check (other_ministry_name is null or char_length(btrim(other_ministry_name)) between 1 and 120),
  constraint reservations_purpose_length check (char_length(btrim(purpose)) between 1 and 500),
  constraint reservations_attendance_range check (estimated_attendance between 1 and 10000),
  constraint reservations_setup_length check (setup_requirements is null or char_length(setup_requirements) <= 1000),
  constraint reservations_requester_notes_length check (requester_notes is null or char_length(requester_notes) <= 1000),
  constraint reservations_admin_notes_length check (admin_notes is null or char_length(admin_notes) <= 4000),
  constraint reservations_requester_message_length check (requester_message is null or char_length(requester_message) <= 1000),
  constraint reservations_token_hash_length check (octet_length(guest_token_hash) = 32),
  constraint reservations_status_timestamps check (
    (status <> 'approved' or approved_at is not null)
    and (status <> 'declined' or declined_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  ),
  -- THE double-booking guard: no two room-holding reservations may overlap in the same
  -- room. [start, end) ranges, so 9–10 and 10–11 do not conflict.
  constraint reservations_no_overlap exclude using gist (
    room_id with =,
    reservation_range with &&
  ) where (status in ('pending', 'approved'))
);

create unique index reservations_reference_code_key on public.reservations (reference_code);
create index reservations_status_start_idx on public.reservations (status, start_at);
create index reservations_start_idx on public.reservations (start_at);
create index reservations_created_idx on public.reservations (created_at desc);
create index reservations_room_idx on public.reservations (room_id);
create index reservations_ministry_idx on public.reservations (ministry_id);
create index reservations_email_idx on public.reservations (requester_email);
create index reservations_search_idx on public.reservations using gin (search_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- notifications (in-app, staff only)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  title text not null,
  message text not null,
  reservation_id uuid references public.reservations (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_type_valid check (type in (
    'reservation_pending', 'reservation_cancelled_by_requester', 'reservation_modified',
    'reservation_approved', 'reservation_declined', 'email_failed'
  )),
  constraint notifications_title_length check (char_length(title) between 1 and 200),
  constraint notifications_message_length check (char_length(message) between 1 and 1000)
);
create index notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index notifications_user_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_reservation_idx on public.notifications (reservation_id);

-- ---------------------------------------------------------------------------
-- email_logs — delivery log AND outbox (rows are queued inside the reservation
-- transaction and sent after the response)
-- ---------------------------------------------------------------------------
create table public.email_logs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid references public.reservations (id) on delete cascade,
  recipient text not null,
  event_type text not null,
  status public.email_status not null default 'queued',
  provider_message_id text,
  error_message text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint email_logs_recipient_valid check (private.is_valid_email(recipient)),
  constraint email_logs_event_type_valid check (event_type in (
    'request_submitted', 'admin_new_request', 'reservation_confirmed', 'reservation_approved',
    'reservation_declined', 'reservation_modified', 'reservation_cancelled', 'admin_reservation_cancelled'
  )),
  constraint email_logs_error_length check (error_message is null or char_length(error_message) <= 500),
  constraint email_logs_attempts_range check (attempt_count between 0 and 100)
);
create index email_logs_reservation_idx on public.email_logs (reservation_id, created_at desc);
create index email_logs_pending_idx on public.email_logs (status, created_at) where status in ('queued', 'sending', 'failed');

-- ---------------------------------------------------------------------------
-- audit_logs — append-only
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles (id) on delete set null,
  actor_kind public.actor_kind not null,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_format check (action ~ '^[a-z_]+\.[a-z_]+$')
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id);

-- ---------------------------------------------------------------------------
-- rate_limit_events — HMAC'd keys only, never raw IPs/emails
-- ---------------------------------------------------------------------------
create table public.rate_limit_events (
  id bigint generated always as identity primary key,
  bucket text not null,
  key_hash text not null,
  created_at timestamptz not null default now(),
  constraint rate_limit_bucket_format check (bucket ~ '^[a-z_:]{1,40}$'),
  constraint rate_limit_key_hash_format check (key_hash ~ '^[0-9a-f]{64}$')
);
create index rate_limit_events_lookup_idx on public.rate_limit_events (bucket, key_hash, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger app_settings_set_updated_at before update on public.app_settings
  for each row execute function private.set_updated_at();
create trigger ministries_set_updated_at before update on public.ministries
  for each row execute function private.set_updated_at();
create trigger amenities_set_updated_at before update on public.amenities
  for each row execute function private.set_updated_at();
create trigger rooms_set_updated_at before update on public.rooms
  for each row execute function private.set_updated_at();
create trigger reservations_set_updated_at before update on public.reservations
  for each row execute function private.set_updated_at();
