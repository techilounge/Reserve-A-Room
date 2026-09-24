-- Reserve-A-Room · Row Level Security and explicit grants (least privilege).
--
-- Guests (anon) can read public room/ministry/amenity data and the public subset of
-- settings. They have NO access to reservations; guest flows go through trusted server
-- code. Staff (authenticated with an active profile) read through RLS; state changes go
-- through SECURITY DEFINER functions that re-check the caller's role.

-- Start from zero, whatever defaults the platform applied.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
revoke execute on all functions in schema private from public, anon, authenticated;

-- Pure validators used by CHECK constraints run with the writer's privileges.
grant execute on function private.is_valid_email(text) to authenticated, service_role;
grant execute on function private.is_valid_advance(integer, public.advance_unit) to authenticated, service_role;
grant execute on function private.is_valid_timezone(text) to authenticated, service_role;

-- RLS helpers and public read-only helpers.
grant execute on function private.is_staff() to anon, authenticated, service_role;
grant execute on function private.is_super_admin() to anon, authenticated, service_role;
grant execute on function public.booking_horizon_date(uuid, timestamptz) to anon, authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.ministries enable row level security;
alter table public.amenities enable row level security;
alter table public.rooms enable row level security;
alter table public.room_amenities enable row level security;
alter table public.reservations enable row level security;
alter table public.notifications enable row level security;
alter table public.email_logs enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limit_events enable row level security;

-- ---------------------------------------------------------------------------
-- Public reference data
-- ---------------------------------------------------------------------------

grant select on public.rooms to anon, authenticated;
grant insert, update on public.rooms to authenticated;
create policy rooms_read on public.rooms for select to anon, authenticated
  using (active or (select private.is_staff()));
create policy rooms_insert_super_admin on public.rooms for insert to authenticated
  with check ((select private.is_super_admin()));
create policy rooms_update_super_admin on public.rooms for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

grant select on public.ministries to anon, authenticated;
grant insert, update on public.ministries to authenticated;
create policy ministries_read on public.ministries for select to anon, authenticated
  using (active or (select private.is_staff()));
create policy ministries_insert_super_admin on public.ministries for insert to authenticated
  with check ((select private.is_super_admin()));
create policy ministries_update_super_admin on public.ministries for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

grant select on public.amenities to anon, authenticated;
grant insert, update on public.amenities to authenticated;
create policy amenities_read on public.amenities for select to anon, authenticated
  using (active or (select private.is_staff()));
create policy amenities_insert_super_admin on public.amenities for insert to authenticated
  with check ((select private.is_super_admin()));
create policy amenities_update_super_admin on public.amenities for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

grant select on public.room_amenities to anon, authenticated;
grant insert, delete on public.room_amenities to authenticated;
create policy room_amenities_read on public.room_amenities for select to anon, authenticated
  using (true);
create policy room_amenities_insert_super_admin on public.room_amenities for insert to authenticated
  with check ((select private.is_super_admin()));
create policy room_amenities_delete_super_admin on public.room_amenities for delete to authenticated
  using ((select private.is_super_admin()));

-- ---------------------------------------------------------------------------
-- Settings: the public subset is readable by everyone; notification recipients are
-- private (see get_admin_settings). Only Super Admins may update.
-- ---------------------------------------------------------------------------

grant select (
  id, church_name, app_name, timezone, contact_email, contact_phone,
  booking_interval_minutes, default_max_advance_value, default_max_advance_unit,
  min_lead_time_minutes, bookable_day_start, bookable_day_end, allow_guest_cancellation,
  email_sender_name, updated_at
) on public.app_settings to anon, authenticated;
grant update (
  church_name, app_name, timezone, contact_email, contact_phone,
  booking_interval_minutes, default_max_advance_value, default_max_advance_unit,
  min_lead_time_minutes, bookable_day_start, bookable_day_end, allow_guest_cancellation,
  extra_admin_notification_emails, email_sender_name
) on public.app_settings to authenticated;
create policy app_settings_read on public.app_settings for select to anon, authenticated
  using (true);
create policy app_settings_update_super_admin on public.app_settings for update to authenticated
  using ((select private.is_super_admin()))
  with check ((select private.is_super_admin()));

create function public.get_admin_settings()
returns public.app_settings
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_super_admin()) then
    raise exception 'Not authorized.' using errcode = 'RAR09';
  end if;
  return (select s from public.app_settings s where s.id);
end;
$$;
grant execute on function public.get_admin_settings() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profiles: staff can see each other (names on approvals etc.); users may edit only
-- their own name and email preference. Role/active changes go through
-- Super-Admin-only functions (Phase 6), never direct updates.
-- ---------------------------------------------------------------------------

grant select on public.profiles to authenticated;
grant update (full_name, email_notifications) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select private.is_staff()));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()) and (select private.is_staff()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Reservations: staff read everything except the guest token hash. No direct writes.
-- ---------------------------------------------------------------------------

grant select (
  id, reference_code, status, source, room_id, start_at, end_at, reservation_range,
  requester_first_name, requester_last_name, requester_email, requester_phone,
  ministry_id, other_ministry_name, purpose, estimated_attendance, setup_requirements,
  requester_notes, admin_notes, requester_message,
  approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission,
  created_by_user_id, approved_by, approved_at, declined_by, declined_at,
  cancelled_by_user_id, cancelled_at, cancelled_by_requester, search_text, created_at, updated_at
) on public.reservations to authenticated;
create policy reservations_read_staff on public.reservations for select to authenticated
  using ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- Notifications: each staff member sees and marks their own.
-- ---------------------------------------------------------------------------

grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and (select private.is_staff()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and (select private.is_staff()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Email logs: staff can read (for delivery status + retry). Written by the server.
-- ---------------------------------------------------------------------------

grant select on public.email_logs to authenticated;
create policy email_logs_read_staff on public.email_logs for select to authenticated
  using ((select private.is_staff()));

-- ---------------------------------------------------------------------------
-- Audit log: Super Admin only, read-only for everyone.
-- ---------------------------------------------------------------------------

grant select on public.audit_logs to authenticated;
create policy audit_logs_read_super_admin on public.audit_logs for select to authenticated
  using ((select private.is_super_admin()));

-- The server (service role) never needs to rewrite history either.
revoke update, delete, truncate on public.audit_logs from service_role;

-- rate_limit_events: no anon/authenticated access at all (service role only).

-- ---------------------------------------------------------------------------
-- First Super Admin bootstrap (called only by scripts/bootstrap-super-admin.ts with
-- the service role key). Refuses once any active Super Admin exists.
-- ---------------------------------------------------------------------------

create function public.bootstrap_first_super_admin(p_user_id uuid, p_full_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('reserve_a_room.super_admins'));

  if exists (select 1 from public.profiles where role = 'super_admin' and active) then
    raise exception 'A Super Admin already exists. Use Users & Roles to add more.' using errcode = 'RAR09';
  end if;

  select lower(email) into v_email from auth.users where id = p_user_id;
  if v_email is null then
    raise exception 'No auth user with id %.', p_user_id using errcode = 'RAR08';
  end if;

  insert into public.profiles (id, email, full_name, role, active)
  values (p_user_id, v_email, btrim(p_full_name), 'super_admin', true)
  on conflict (id) do update
    set role = 'super_admin', active = true, full_name = excluded.full_name, email = excluded.email;

  perform private.write_audit('user.bootstrapped', 'user', p_user_id::text,
    jsonb_build_object('role', 'super_admin'), 'system');
end;
$$;
revoke execute on function public.bootstrap_first_super_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_super_admin(uuid, text) to service_role;
