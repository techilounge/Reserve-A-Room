-- Church Calendar Phase 1: configuration and independently revocable planner access.
-- No events, allocations or public calendar data are created by this migration.

create table public.calendar_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 150),
  start_date date not null,
  end_date date not null,
  submission_opens_at timestamptz not null,
  submission_deadline timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'open', 'review', 'finalized', 'archived')),
  instructions text check (char_length(instructions) <= 5000),
  created_by uuid references public.profiles(id),
  finalized_by uuid references public.profiles(id),
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (isfinite(start_date) and isfinite(end_date) and end_date >= start_date and end_date <= (start_date + interval '3 years')::date),
  check (isfinite(submission_opens_at) and isfinite(submission_deadline) and submission_deadline > submission_opens_at)
);

create table public.ministry_calendar_plans (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.calendar_cycles(id),
  ministry_id uuid not null references public.ministries(id),
  reference_code uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  unique (cycle_id, ministry_id)
);

create table public.calendar_plan_access (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ministry_calendar_plans(id),
  contact_name text not null check (char_length(btrim(contact_name)) between 1 and 120),
  contact_email text not null check (private.is_valid_email(contact_email)),
  contact_phone text check (char_length(contact_phone) <= 40),
  label text not null check (label in ('primary', 'secondary', 'additional')),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  token_seed bytea not null check (octet_length(token_seed) = 16),
  version integer not null default 1 check (version > 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index calendar_plan_access_unrevoked_email_key
  on public.calendar_plan_access (plan_id, lower(btrim(contact_email))) where revoked_at is null;
create index calendar_plan_access_plan_idx on public.calendar_plan_access(plan_id);

create table public.calendar_plan_sessions (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.calendar_plan_access(id),
  grant_version integer not null,
  session_hash bytea not null unique check (octet_length(session_hash) = 32),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index calendar_plan_sessions_grant_idx on public.calendar_plan_sessions(grant_id);

create table public.calendar_resources (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null check (category in ('equipment', 'facility', 'vehicle', 'service', 'staff_support', 'other')),
  description text check (char_length(description) <= 2000),
  available_quantity integer not null check (available_quantity > 0),
  active boolean not null default true,
  private_notes text check (char_length(private_notes) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index calendar_resources_name_key on public.calendar_resources(lower(btrim(name)));

-- A distinct delivery ID allows multiple invitations while the existing outbox's
-- unique key still makes retries of each individual delivery idempotent.
create table private.calendar_invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.calendar_plan_access(id),
  grant_version integer not null,
  created_at timestamptz not null default now()
);
alter table private.calendar_invitation_deliveries enable row level security;
revoke all on private.calendar_invitation_deliveries from public, anon, authenticated, service_role;

alter table public.calendar_cycles enable row level security;
alter table public.ministry_calendar_plans enable row level security;
alter table public.calendar_plan_access enable row level security;
alter table public.calendar_plan_sessions enable row level security;
alter table public.calendar_resources enable row level security;
revoke all on public.calendar_cycles, public.ministry_calendar_plans, public.calendar_plan_access,
  public.calendar_plan_sessions, public.calendar_resources from public, anon, authenticated, service_role;

grant select on public.calendar_cycles, public.ministry_calendar_plans, public.calendar_resources to authenticated;
grant select (id, plan_id, contact_name, contact_email, contact_phone, label, version, expires_at,
  revoked_at, last_used_at, created_at, updated_at) on public.calendar_plan_access to authenticated;
create policy calendar_cycles_super_read on public.calendar_cycles for select to authenticated using (private.is_super_admin());
create policy calendar_plans_super_read on public.ministry_calendar_plans for select to authenticated using (private.is_super_admin());
create policy calendar_access_super_read on public.calendar_plan_access for select to authenticated using (private.is_super_admin());
create policy calendar_resources_super_read on public.calendar_resources for select to authenticated using (private.is_super_admin());

create function private.calendar_audit(p_actor uuid, p_action text, p_entity text, p_id uuid, p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs(actor_user_id, actor_kind, action, entity_type, entity_id, metadata)
  values (p_actor, 'staff', p_action, p_entity, p_id::text, p_metadata);
$$;

create function private.is_calendar_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role' = 'service_role', false);
$$;

create function public.save_calendar_cycle(
  p_id uuid, p_name text, p_start_date date, p_end_date date,
  p_opens_at timestamptz, p_deadline timestamptz, p_instructions text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_id uuid;
begin
  if p_id is null then
    insert into public.calendar_cycles(name, start_date, end_date, submission_opens_at, submission_deadline, instructions, created_by)
    values (btrim(p_name), p_start_date, p_end_date, p_opens_at, p_deadline, nullif(btrim(p_instructions), ''), v_actor)
    returning id into v_id;
  else
    update public.calendar_cycles set name = btrim(p_name), start_date = p_start_date, end_date = p_end_date,
      submission_opens_at = p_opens_at, submission_deadline = p_deadline,
      instructions = nullif(btrim(p_instructions), ''), updated_at = now()
    where id = p_id and status in ('draft', 'open') returning id into v_id;
    if v_id is null then raise exception 'Cycle cannot be changed in its current state.' using errcode = 'RAR09'; end if;
    -- Extend/shorten currently active grants with the deadline, but never revive
    -- an expired grant (which could exceed the five-planner limit).
    update public.calendar_plan_access a set expires_at = p_deadline, updated_at = now()
      from public.ministry_calendar_plans p
      where p.id = a.plan_id and p.cycle_id = v_id and a.revoked_at is null and a.expires_at > now();
  end if;
  perform private.calendar_audit(v_actor, case when p_id is null then 'calendar_cycle.created' else 'calendar_cycle.updated' end,
    'calendar_cycle', v_id, jsonb_build_object('name', btrim(p_name)));
  return v_id;
end;
$$;

create function public.transition_calendar_cycle(p_id uuid, p_status text, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_cycle public.calendar_cycles;
begin
  select * into v_cycle from public.calendar_cycles where id = p_id for update;
  if not found then raise exception 'Cycle not found.' using errcode = 'RAR09'; end if;
  if not ((v_cycle.status = 'draft' and p_status in ('open', 'archived'))
       or (v_cycle.status = 'open' and p_status in ('review', 'archived'))
       or (v_cycle.status = 'review' and p_status in ('open', 'finalized', 'archived'))
       or (v_cycle.status = 'finalized' and p_status in ('open', 'archived'))) then
    raise exception 'Invalid cycle transition.' using errcode = 'RAR09';
  end if;
  if p_status = 'open' and v_cycle.status in ('review', 'finalized')
     and (p_reason is null or char_length(btrim(p_reason)) not between 3 and 500) then
    raise exception 'A reason is required to reopen a cycle.' using errcode = 'RAR09';
  end if;
  update public.calendar_cycles set status = p_status, updated_at = now(),
    finalized_at = case when p_status = 'finalized' then now() when p_status = 'open' then null else finalized_at end,
    finalized_by = case when p_status = 'finalized' then v_actor when p_status = 'open' then null else finalized_by end
  where id = p_id;
  perform private.calendar_audit(v_actor, 'calendar_cycle.transitioned', 'calendar_cycle', p_id,
    jsonb_build_object('name', v_cycle.name, 'from', v_cycle.status, 'to', p_status,
      'reason', nullif(btrim(p_reason), ''), 'changes',
      jsonb_build_object('status', jsonb_build_object('from', v_cycle.status, 'to', p_status)) ||
      case when nullif(btrim(p_reason), '') is not null
        then jsonb_build_object('reason', jsonb_build_object('to', btrim(p_reason))) else '{}'::jsonb end));
end;
$$;

create function public.add_calendar_ministry(p_cycle_id uuid, p_ministry_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_id uuid; v_status text;
begin
  select status into v_status from public.calendar_cycles where id = p_cycle_id for update;
  if v_status is null or v_status not in ('draft', 'open') then
    raise exception 'Ministries cannot be added to this cycle.' using errcode = 'RAR09';
  end if;
  if not exists (select 1 from public.ministries where id = p_ministry_id and active) then
    raise exception 'An active ministry is required.' using errcode = 'RAR09';
  end if;
  insert into public.ministry_calendar_plans(cycle_id, ministry_id) values (p_cycle_id, p_ministry_id) returning id into v_id;
  perform private.calendar_audit(v_actor, 'calendar_plan.created', 'calendar_plan', v_id,
    jsonb_build_object('cycle_id', p_cycle_id, 'ministry_id', p_ministry_id));
  return v_id;
end;
$$;

create function public.save_calendar_resource(p_id uuid, p_name text, p_category text, p_quantity integer,
  p_active boolean, p_description text, p_private_notes text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_id uuid;
begin
  if p_id is null then
    insert into public.calendar_resources(name, category, available_quantity, active, description, private_notes)
    values (btrim(p_name), p_category, p_quantity, p_active, nullif(btrim(p_description), ''), nullif(btrim(p_private_notes), ''))
    returning id into v_id;
  else
    update public.calendar_resources set name = btrim(p_name), category = p_category, available_quantity = p_quantity,
      active = p_active, description = nullif(btrim(p_description), ''), private_notes = nullif(btrim(p_private_notes), ''),
      updated_at = now() where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Resource not found.' using errcode = 'RAR09'; end if;
  end if;
  perform private.calendar_audit(v_actor, case when p_id is null then 'calendar_resource.created' else 'calendar_resource.updated' end,
    'calendar_resource', v_id, jsonb_build_object('name', btrim(p_name), 'active', p_active));
  return v_id;
end;
$$;

create function public.invite_calendar_planner(p_plan_id uuid, p_grant_id uuid, p_name text, p_email text,
  p_phone text, p_label text, p_token_hash text, p_token_seed text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_cycle public.calendar_cycles;
  v_delivery uuid := gen_random_uuid(); v_count integer; v_old uuid;
begin
  -- Every invitation and rotation locks cycle then plan, so a concurrent close or
  -- sixth invite cannot slip between the state check and the insert.
  select c.* into v_cycle from public.calendar_cycles c
    join public.ministry_calendar_plans p on p.cycle_id = c.id where p.id = p_plan_id for update of c;
  if not found or v_cycle.status not in ('draft', 'open') or v_cycle.submission_deadline <= now() then
    raise exception 'This cycle is not accepting invitations.' using errcode = 'RAR09';
  end if;
  perform 1 from public.ministry_calendar_plans where id = p_plan_id for update;
  select count(*) into v_count from public.calendar_plan_access
    where plan_id = p_plan_id and revoked_at is null and expires_at > now();
  if v_count >= 5 then raise exception 'A ministry plan can have at most five active planners.' using errcode = 'RAR09'; end if;
  for v_old in select id from public.calendar_plan_access where plan_id = p_plan_id
    and lower(btrim(contact_email)) = lower(btrim(p_email)) and revoked_at is null and expires_at <= now() for update
  loop
    update public.calendar_plan_access set revoked_at = now(), updated_at = now() where id = v_old;
    perform private.calendar_audit(v_actor, 'calendar_access.expired', 'calendar_access', v_old);
  end loop;
  insert into public.calendar_plan_access(id, plan_id, contact_name, contact_email, contact_phone, label,
    token_hash, token_seed, expires_at)
  values (p_grant_id, p_plan_id, btrim(p_name), lower(btrim(p_email)), nullif(btrim(p_phone), ''), p_label,
    decode(p_token_hash, 'hex'), decode(p_token_seed, 'hex'), v_cycle.submission_deadline);
  insert into private.calendar_invitation_deliveries(id, grant_id, grant_version) values (v_delivery, p_grant_id, 1);
  perform private.queue_system_email(p_email, 'calendar_planner_invited', 'calendar_invitation', v_delivery);
  perform private.calendar_audit(v_actor, 'calendar_access.invited', 'calendar_access', p_grant_id,
    jsonb_build_object('plan_id', p_plan_id, 'label', p_label, 'full_name', btrim(p_name), 'email', lower(btrim(p_email))));
  return v_delivery;
end;
$$;

create function public.rotate_calendar_invitation(p_grant_id uuid, p_expected_version integer,
  p_token_hash text, p_token_seed text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_cycle public.calendar_cycles;
  v_grant public.calendar_plan_access; v_delivery uuid := gen_random_uuid();
begin
  select c.* into v_cycle from public.calendar_cycles c
    join public.ministry_calendar_plans p on p.cycle_id = c.id
    join public.calendar_plan_access a on a.plan_id = p.id where a.id = p_grant_id for update of c;
  if not found or v_cycle.status not in ('draft', 'open') or v_cycle.submission_deadline <= now() then
    raise exception 'This cycle is not accepting invitations.' using errcode = 'RAR09';
  end if;
  select * into v_grant from public.calendar_plan_access where id = p_grant_id for update;
  if v_grant.revoked_at is not null or v_grant.expires_at <= now() or v_grant.version <> p_expected_version then
    raise exception 'Invitation is inactive or has changed. Refresh and try again.' using errcode = 'RAR09';
  end if;
  update public.calendar_plan_access set version = version + 1, token_hash = decode(p_token_hash, 'hex'),
    token_seed = decode(p_token_seed, 'hex'), expires_at = v_cycle.submission_deadline, updated_at = now() where id = p_grant_id;
  update public.calendar_plan_sessions set revoked_at = now() where grant_id = p_grant_id and revoked_at is null;
  insert into private.calendar_invitation_deliveries(id, grant_id, grant_version)
    values (v_delivery, p_grant_id, v_grant.version + 1);
  perform private.queue_system_email(v_grant.contact_email, 'calendar_planner_invited', 'calendar_invitation', v_delivery);
  perform private.calendar_audit(v_actor, 'calendar_access.rotated', 'calendar_access', p_grant_id,
    jsonb_build_object('version', v_grant.version + 1, 'full_name', v_grant.contact_name, 'email', v_grant.contact_email));
  return v_delivery;
end;
$$;

create function public.revoke_calendar_planner(p_grant_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_super_admin(); v_cycle public.calendar_cycles; v_grant public.calendar_plan_access;
begin
  select c.* into v_cycle from public.calendar_cycles c
    join public.ministry_calendar_plans p on p.cycle_id = c.id
    join public.calendar_plan_access a on a.plan_id = p.id where a.id = p_grant_id for update of c;
  if not found then
    raise exception 'Planner access was not found.' using errcode = 'RAR09';
  end if;
  update public.calendar_plan_access set revoked_at = now(), updated_at = now()
    where id = p_grant_id and revoked_at is null returning * into v_grant;
  if not found then raise exception 'Invitation is already revoked.' using errcode = 'RAR09'; end if;
  update public.calendar_plan_sessions set revoked_at = now() where grant_id = p_grant_id and revoked_at is null;
  perform private.calendar_audit(v_actor, 'calendar_access.revoked', 'calendar_access', p_grant_id,
    jsonb_build_object('full_name', v_grant.contact_name, 'email', v_grant.contact_email));
end;
$$;

-- Only the server's service-role worker may inspect a seed, and old deliveries
-- become unsendable as soon as their grant is rotated or revoked.
create function public.calendar_invitation_context(p_email_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('grant_id', a.id, 'plan_reference', p.reference_code, 'version', a.version,
    'seed', encode(a.token_seed, 'hex'), 'contact_name', a.contact_name, 'ministry_name', m.name,
    'cycle_name', c.name, 'opens_at', c.submission_opens_at, 'deadline', c.submission_deadline, 'created_at', d.created_at)
  from public.system_email_logs e
  join private.calendar_invitation_deliveries d on d.id = e.entity_id and e.entity_type = 'calendar_invitation'
  join public.calendar_plan_access a on a.id = d.grant_id and a.version = d.grant_version
  join public.ministry_calendar_plans p on p.id = a.plan_id
  join public.calendar_cycles c on c.id = p.cycle_id
  join public.ministries m on m.id = p.ministry_id
  where private.is_calendar_service() and e.id = p_email_id and e.event_type = 'calendar_planner_invited'
    and a.revoked_at is null and a.expires_at > now() and c.status in ('draft', 'open');
$$;

create function public.calendar_invitation_delivery_status()
returns table(grant_id uuid, status public.email_status, error_message text, attempted_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_super_admin();
  return query select distinct on (d.grant_id) d.grant_id, e.status, e.error_message, e.last_attempt_at
    from private.calendar_invitation_deliveries d
    join public.system_email_logs e on e.entity_type = 'calendar_invitation' and e.entity_id = d.id
    order by d.grant_id, d.grant_version desc, d.created_at desc, d.id desc;
end;
$$;

create function public.exchange_calendar_planner_session(p_plan_id uuid, p_grant_id uuid,
  p_token_hash text, p_session_hash text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_grant public.calendar_plan_access; v_cycle public.calendar_cycles;
begin
  if not private.is_calendar_service() then raise exception 'Service access required.' using errcode = 'RAR09'; end if;
  select c.* into v_cycle from public.calendar_cycles c
    join public.ministry_calendar_plans p on p.cycle_id = c.id
    join public.calendar_plan_access a on a.plan_id = p.id
    where p.reference_code = p_plan_id and a.id = p_grant_id for update of c;
  if not found or v_cycle.status <> 'open' or now() < v_cycle.submission_opens_at or now() >= v_cycle.submission_deadline then return false; end if;
  select * into v_grant from public.calendar_plan_access where id = p_grant_id for update;
  if not found or v_grant.revoked_at is not null or v_grant.expires_at <= now()
    or v_grant.token_hash <> decode(p_token_hash, 'hex') then return false; end if;
  insert into public.calendar_plan_sessions(grant_id, grant_version, session_hash, expires_at)
    values (v_grant.id, v_grant.version, decode(p_session_hash, 'hex'), least(now() + interval '12 hours', v_grant.expires_at, v_cycle.submission_deadline));
  update public.calendar_plan_access set last_used_at = now() where id = p_grant_id;
  insert into public.audit_logs(actor_kind, action, entity_type, entity_id, metadata)
    values ('guest', 'calendar_access.opened', 'calendar_access', p_grant_id::text,
      jsonb_build_object('full_name', v_grant.contact_name, 'plan_id', v_grant.plan_id));
  return true;
end;
$$;

create function public.calendar_planner_session_context(p_plan_id uuid, p_session_hash text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('plan_id', p.id, 'grant_id', a.id, 'contact_name', a.contact_name,
    'ministry_name', m.name, 'cycle_name', c.name, 'start_date', c.start_date, 'end_date', c.end_date,
    'deadline', c.submission_deadline, 'instructions', c.instructions)
  from public.calendar_plan_sessions s
  join public.calendar_plan_access a on a.id = s.grant_id and a.version = s.grant_version
  join public.ministry_calendar_plans p on p.id = a.plan_id
  join public.calendar_cycles c on c.id = p.cycle_id
  join public.ministries m on m.id = p.ministry_id
  where private.is_calendar_service() and p.reference_code = p_plan_id and s.session_hash = decode(p_session_hash, 'hex')
    and s.revoked_at is null and s.expires_at > now() and a.revoked_at is null and a.expires_at > now()
    and c.status = 'open' and now() >= c.submission_opens_at and now() < c.submission_deadline;
$$;

-- Both catalog reads omit private notes and inactive resources. Planner access
-- requires the same plan-scoped session used by all future planner operations.
create function public.calendar_active_resources()
returns table(id uuid, name text, category text, description text, available_quantity integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select r.id, r.name, r.category, r.description, r.available_quantity
    from public.calendar_resources r where r.active order by r.name;
end;
$$;

create function public.calendar_planner_resources(p_plan_id uuid, p_session_hash text)
returns table(id uuid, name text, category text, description text, available_quantity integer)
language sql stable security definer set search_path = '' as $$
  select r.id, r.name, r.category, r.description, r.available_quantity
  from public.calendar_resources r
  where private.is_calendar_service() and r.active
    and public.calendar_planner_session_context(p_plan_id, p_session_hash) is not null
  order by r.name;
$$;

revoke execute on function private.calendar_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.is_calendar_service() from public, anon, authenticated, service_role;
revoke execute on function public.save_calendar_cycle(uuid, text, date, date, timestamptz, timestamptz, text),
  public.transition_calendar_cycle(uuid, text, text), public.add_calendar_ministry(uuid, uuid),
  public.save_calendar_resource(uuid, text, text, integer, boolean, text, text) from public, anon, service_role;
grant execute on function public.save_calendar_cycle(uuid, text, date, date, timestamptz, timestamptz, text),
  public.transition_calendar_cycle(uuid, text, text), public.add_calendar_ministry(uuid, uuid),
  public.save_calendar_resource(uuid, text, text, integer, boolean, text, text) to authenticated;
revoke execute on function public.calendar_invitation_delivery_status() from public, anon, service_role;
grant execute on function public.calendar_invitation_delivery_status() to authenticated;
revoke execute on function public.calendar_active_resources() from public, anon, service_role;
grant execute on function public.calendar_active_resources() to authenticated;
revoke execute on function public.invite_calendar_planner(uuid, uuid, text, text, text, text, text, text),
  public.rotate_calendar_invitation(uuid, integer, text, text), public.revoke_calendar_planner(uuid) from public, anon, service_role;
grant execute on function public.invite_calendar_planner(uuid, uuid, text, text, text, text, text, text),
  public.rotate_calendar_invitation(uuid, integer, text, text), public.revoke_calendar_planner(uuid) to authenticated;
revoke execute on function public.calendar_invitation_context(uuid),
  public.exchange_calendar_planner_session(uuid, uuid, text, text), public.calendar_planner_session_context(uuid, text)
  from public, anon, authenticated;
grant execute on function public.calendar_invitation_context(uuid),
  public.exchange_calendar_planner_session(uuid, uuid, text, text), public.calendar_planner_session_context(uuid, text),
  public.calendar_planner_resources(uuid, text)
  to service_role;
revoke execute on function public.calendar_planner_resources(uuid, text) from public, anon, authenticated;
