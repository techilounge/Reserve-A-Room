-- Reserve-A-Room · Staff login audit, invitation acceptance, and first-login email.

alter table public.profiles
  add column invitation_accepted_at timestamptz,
  add column first_login_at timestamptz;

-- Preserve historical state without generating retroactive emails during migration.
update public.profiles p
set first_login_at = u.last_sign_in_at,
    invitation_accepted_at = case when p.invited_by is not null then u.last_sign_in_at end
from auth.users u
where u.id = p.id and u.last_sign_in_at is not null;

create function public.complete_staff_password_setup()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_profile public.profiles;
  v_now timestamptz := now();
  v_super public.profiles;
begin
  select * into v_profile from public.profiles where id = v_actor for update;
  if v_profile.invited_by is null or v_profile.invitation_accepted_at is not null then
    return false;
  end if;

  update public.profiles
  set invitation_accepted_at = v_now,
      first_login_at = coalesce(first_login_at, v_now)
  where id = v_actor;

  perform private.write_audit(
    'user.invitation_accepted', 'user', v_actor::text,
    jsonb_build_object('full_name', v_profile.full_name, 'email', v_profile.email, 'role', v_profile.role)
  );
  perform private.write_audit(
    'user.logged_in', 'user', v_actor::text,
    jsonb_build_object('method', 'invitation_setup', 'role', v_profile.role)
  );

  for v_super in
    select * from public.profiles
    where active and role = 'super_admin' and id <> v_actor
  loop
    perform private.queue_system_email(
      v_super.email,
      'admin_first_login',
      'user',
      v_actor,
      jsonb_build_object('accepted_at', v_now)
    );
  end loop;
  return true;
end;
$$;

create function public.record_staff_login(p_method text default 'password')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := private.require_staff();
  v_profile public.profiles;
  v_super public.profiles;
begin
  if p_method <> 'password' then
    raise exception 'Unsupported login method.' using errcode = 'RAR10';
  end if;
  select * into v_profile from public.profiles where id = v_actor for update;
  update public.profiles set first_login_at = coalesce(first_login_at, now()) where id = v_actor;
  perform private.write_audit(
    'user.logged_in', 'user', v_actor::text,
    jsonb_build_object('method', p_method, 'role', v_profile.role)
  );

  -- Idempotent recovery for an accepted invited account whose notification was never queued.
  if v_profile.invited_by is not null and v_profile.invitation_accepted_at is not null then
    for v_super in
      select * from public.profiles
      where active and role = 'super_admin' and id <> v_actor
    loop
      perform private.queue_system_email(
        v_super.email,
        'admin_first_login',
        'user',
        v_actor,
        jsonb_build_object('accepted_at', v_profile.invitation_accepted_at)
      );
    end loop;
  end if;
end;
$$;

-- Extend the generic system-email context to user lifecycle events.
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
  left join public.rooms room on room.id = series.room_id
  left join public.ministries ministry on ministry.id = series.ministry_id
  left join public.profiles profile on e.entity_type = 'user' and profile.id = e.entity_id
  where e.id = p_email_id and settings.id;
$$;

create or replace function public.complete_system_email(
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
  v_email public.system_email_logs;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    raise exception 'Invalid email status.' using errcode = 'RAR10';
  end if;
  update public.system_email_logs
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, provider_message_id),
      error_message = case when p_status = 'failed' then left(p_error, 500) else null end,
      sent_at = case when p_status = 'sent' then now() else sent_at end
  where id = p_id
  returning * into v_email;

  if p_status = 'failed' then
    perform private.notify_staff(
      'email_failed',
      'System email not delivered',
      'An email to ' || v_email.recipient || ' could not be sent. Review the related record.',
      null
    );
  end if;
end;
$$;

revoke execute on function public.complete_staff_password_setup() from public, anon;
grant execute on function public.complete_staff_password_setup() to authenticated, service_role;
revoke execute on function public.record_staff_login(text) from public, anon;
grant execute on function public.record_staff_login(text) to authenticated, service_role;
