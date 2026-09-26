-- Reserve-A-Room · Auditable guest acceptance of Privacy Policy and Terms.
-- RAR12 = explicit legal acceptance is required for a new guest reservation.

alter table public.reservations
  add column privacy_accepted_at timestamptz,
  add column privacy_version text,
  add column terms_accepted_at timestamptz,
  add column terms_version text,
  add constraint reservations_legal_consent_complete check (
    (
      privacy_accepted_at is null and privacy_version is null
      and terms_accepted_at is null and terms_version is null
    )
    or
    (
      privacy_accepted_at is not null and nullif(btrim(privacy_version), '') is not null
      and terms_accepted_at is not null and nullif(btrim(terms_version), '') is not null
    )
  );

comment on column public.reservations.privacy_accepted_at is
  'When the guest explicitly accepted the Privacy Policy; null for legacy and staff-created reservations.';
comment on column public.reservations.privacy_version is
  'Repository policy version accepted by the guest.';
comment on column public.reservations.terms_accepted_at is
  'When the guest explicitly accepted the Terms of Service; null for legacy and staff-created reservations.';
comment on column public.reservations.terms_version is
  'Repository terms version accepted by the guest.';

-- Preserve the original transaction implementation as an owner-only helper. Moving it
-- out of public also removes the consent-free RPC from PostgREST's exposed schema.
alter function public.create_guest_reservation(
  uuid, timestamptz, timestamptz, text, text, text, text, text, integer,
  bytea, bytea, uuid, text, text, text
) set schema private;

alter function private.create_guest_reservation(
  uuid, timestamptz, timestamptz, text, text, text, text, text, integer,
  bytea, bytea, uuid, text, text, text
) rename to create_guest_reservation_legacy;

revoke execute on function private.create_guest_reservation_legacy(
  uuid, timestamptz, timestamptz, text, text, text, text, text, integer,
  bytea, bytea, uuid, text, text, text
) from public, anon, authenticated, service_role;

create function public.create_guest_reservation(
  p_room_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_purpose text,
  p_estimated_attendance integer,
  p_token_hash bytea,
  p_token_seed bytea,
  p_privacy_accepted boolean,
  p_terms_accepted boolean,
  p_privacy_version text,
  p_terms_version text,
  p_ministry_id uuid default null,
  p_other_ministry_name text default null,
  p_setup_requirements text default null,
  p_requester_notes text default null
)
returns table (id uuid, reference_code text, status public.reservation_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created record;
  v_accepted_at timestamptz := clock_timestamp();
begin
  if p_privacy_accepted is not true
     or p_terms_accepted is not true
     or nullif(btrim(p_privacy_version), '') is null
     or nullif(btrim(p_terms_version), '') is null then
    raise exception 'Privacy Policy and Terms of Service acceptance is required.' using errcode = 'RAR12';
  end if;

  select * into v_created
  from private.create_guest_reservation_legacy(
    p_room_id,
    p_start_at,
    p_end_at,
    p_first_name,
    p_last_name,
    p_email,
    p_phone,
    p_purpose,
    p_estimated_attendance,
    p_token_hash,
    p_token_seed,
    p_ministry_id,
    p_other_ministry_name,
    p_setup_requirements,
    p_requester_notes
  );

  update public.reservations
  set privacy_accepted_at = v_accepted_at,
      privacy_version = btrim(p_privacy_version),
      terms_accepted_at = v_accepted_at,
      terms_version = btrim(p_terms_version)
  where reservations.id = v_created.id;

  return query select v_created.id, v_created.reference_code, v_created.status;
end;
$$;

revoke execute on function public.create_guest_reservation(
  uuid, timestamptz, timestamptz, text, text, text, text, text, integer,
  bytea, bytea, boolean, boolean, text, text, uuid, text, text, text
) from public, anon, authenticated;

grant execute on function public.create_guest_reservation(
  uuid, timestamptz, timestamptz, text, text, text, text, text, integer,
  bytea, bytea, boolean, boolean, text, text, uuid, text, text, text
) to service_role;
