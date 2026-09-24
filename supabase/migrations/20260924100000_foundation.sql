-- Reserve-A-Room · Foundation: extensions, schemas, least-privilege defaults, types.
--
-- Supabase grants ALL on every new public table/function to anon + authenticated by
-- default. This app follows least privilege instead: those defaults are revoked here and
-- every table/function grants exactly what it needs in later migrations.

create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal helpers live in a schema that is NOT exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
-- Postgres grants EXECUTE on every new function to PUBLIC. Per-schema default privileges
-- can only ADD to that global default, so it has to be revoked globally. Every function
-- in this project grants EXECUTE explicitly to exactly the roles that need it.
alter default privileges revoke execute on functions from public;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------

create type public.app_role as enum ('admin', 'super_admin');

-- pending + approved hold the room; declined + cancelled release it.
create type public.reservation_status as enum ('pending', 'approved', 'declined', 'cancelled');

create type public.advance_unit as enum ('day', 'week', 'month');

create type public.reservation_source as enum ('guest', 'admin');

create type public.email_status as enum ('queued', 'sending', 'sent', 'failed', 'skipped');

create type public.actor_kind as enum ('guest', 'staff', 'system');

-- ---------------------------------------------------------------------------
-- Pure validators (used by CHECK constraints)
-- ---------------------------------------------------------------------------

create function private.is_valid_email(value text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select value is not null
    and char_length(value) <= 254
    and value = lower(value)
    and value ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
$$;

-- Upper bounds keep every unit at roughly two years.
create function private.is_valid_advance(value integer, unit public.advance_unit)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case unit
    when 'day' then value between 1 and 730
    when 'week' then value between 1 and 104
    when 'month' then value between 1 and 24
    else false
  end;
$$;

create function private.is_valid_timezone(value text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = value);
$$;

-- Last selectable local date: `today` plus N days/weeks/months (inclusive).
-- Month arithmetic clamps to month end (Jan 31 + 1 month = Feb 28), identical to
-- date-fns addMonths used by the UI.
create function private.add_advance(today date, value integer, unit public.advance_unit)
returns date
language sql
immutable
set search_path = ''
as $$
  select (today + case unit
    when 'day' then pg_catalog.make_interval(days => value)
    when 'week' then pg_catalog.make_interval(weeks => value)
    when 'month' then pg_catalog.make_interval(months => value)
  end)::date;
$$;

-- Generic updated_at maintenance.
create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;
