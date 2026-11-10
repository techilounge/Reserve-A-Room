-- Append-only, deliberately content-free publication history. A public approval
-- publishes an occurrence; merely drafting or submitting one never does. Deferred
-- reconciliation observes the final state of an atomic replacement, including its
-- copied occurrence cancellations, rather than an intermediate state.
create table private.calendar_publication_history (
  event_id uuid not null,
  logical_occurrence_id uuid not null,
  sequence integer not null check (sequence >= 0),
  status text not null check (status in ('published','cancelled')),
  commitment_id uuid not null references public.calendar_event_commitments(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  local_start_date date not null,
  local_end_date date not null,
  timezone text not null,
  all_day boolean not null,
  changed_at timestamptz not null default now(),
  primary key(event_id,logical_occurrence_id,sequence)
);
revoke all on private.calendar_publication_history from public,anon,authenticated,service_role;

create function private.guard_calendar_publication_history() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Publication history is append-only.' using errcode='RAR09';
end;
$$;
create trigger calendar_publication_history_guard before update or delete on private.calendar_publication_history
  for each row execute function private.guard_calendar_publication_history();
revoke execute on function private.guard_calendar_publication_history() from public,anon,authenticated,service_role;

create function private.reconcile_calendar_publication(p_event uuid) returns void
language plpgsql security definer set search_path='' as $$
declare item record; previous private.calendar_publication_history;
begin
  -- Approval and cancellation already hold this same transaction-scoped lock.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reserve_a_room.calendar_approval',0));
  for item in
    select cm.id commitment_id,s.plan_revision,o.logical_occurrence_id,o.start_at,o.end_at,
      o.local_start::date local_start_date,o.local_end::date local_end_date,o.timezone,o.all_day
    from public.calendar_event_commitments cm
    join public.calendar_event_submissions s on s.id=cm.submission_id and s.event_id=cm.event_id
    join public.calendar_submission_occurrences o on o.submission_id=s.id
    where cm.event_id=p_event and cm.state='active' and s.visibility='public'
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
        where cc.commitment_id=cm.id and cc.logical_occurrence_id=o.logical_occurrence_id)
    order by o.logical_occurrence_id
  loop
    select * into previous from private.calendar_publication_history h
      where h.event_id=p_event and h.logical_occurrence_id=item.logical_occurrence_id order by h.sequence desc limit 1;
    if previous.event_id is null or previous.status<>'published' or previous.commitment_id<>item.commitment_id then
      insert into private.calendar_publication_history(event_id,logical_occurrence_id,sequence,status,commitment_id,
        start_at,end_at,local_start_date,local_end_date,timezone,all_day)
      values(p_event,item.logical_occurrence_id,greatest(coalesce(previous.sequence+1,0),item.plan_revision),'published',item.commitment_id,
        item.start_at,item.end_at,item.local_start_date,item.local_end_date,item.timezone,item.all_day);
    end if;
  end loop;
  -- Only identities previously available publicly can produce cancellations.
  for item in
    select distinct on (h.logical_occurrence_id) h.* from private.calendar_publication_history h
    where h.event_id=p_event order by h.logical_occurrence_id,h.sequence desc
  loop
    if item.status='published' and not exists (
      select 1 from public.calendar_event_commitments cm
      join public.calendar_event_submissions s on s.id=cm.submission_id and s.event_id=cm.event_id
      join public.calendar_submission_occurrences o on o.submission_id=s.id
      where cm.event_id=p_event and cm.state='active' and s.visibility='public'
        and o.logical_occurrence_id=item.logical_occurrence_id
        and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
          where cc.commitment_id=cm.id and cc.logical_occurrence_id=o.logical_occurrence_id)
    ) then
      insert into private.calendar_publication_history(event_id,logical_occurrence_id,sequence,status,commitment_id,
        start_at,end_at,local_start_date,local_end_date,timezone,all_day)
      values(p_event,item.logical_occurrence_id,item.sequence+1,'cancelled',item.commitment_id,
        item.start_at,item.end_at,item.local_start_date,item.local_end_date,item.timezone,item.all_day);
    end if;
  end loop;
end;
$$;
revoke execute on function private.reconcile_calendar_publication(uuid) from public,anon,authenticated,service_role;

create function private.calendar_publication_commitment_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.reconcile_calendar_publication(new.event_id);
  return null;
end;
$$;
create constraint trigger calendar_publication_commitment after insert or update on public.calendar_event_commitments
  deferrable initially deferred for each row execute function private.calendar_publication_commitment_trigger();
revoke execute on function private.calendar_publication_commitment_trigger() from public,anon,authenticated,service_role;

create function private.calendar_publication_cancellation_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.reconcile_calendar_publication((select event_id from public.calendar_event_commitments where id=new.commitment_id));
  return null;
end;
$$;
create constraint trigger calendar_publication_cancellation after insert on public.calendar_commitment_occurrence_cancellations
  deferrable initially deferred for each row execute function private.calendar_publication_cancellation_trigger();
revoke execute on function private.calendar_publication_cancellation_trigger() from public,anon,authenticated,service_role;

-- Only presently-public approvals can be safely seeded on upgrade. Historical
-- visibility before this migration is unknowable and is never guessed.
do $$ declare item record; begin
  for item in select distinct cm.event_id from public.calendar_event_commitments cm
    join public.calendar_event_submissions s on s.id=cm.submission_id
    where cm.state='active' and s.visibility='public' loop
    perform private.reconcile_calendar_publication(item.event_id);
  end loop;
end $$;

-- The website remains the active-only read. Enrich its sequence from the history
-- so all clients agree after a withdrawal and later republication.
alter function public.calendar_public_occurrences(date,date,integer,integer) set schema private;
revoke all on function private.calendar_public_occurrences(date,date,integer,integer) from public,anon,authenticated,service_role;
create function public.calendar_public_occurrences(p_from date,p_to date,p_limit integer default 200,p_offset integer default 0)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_set(base.v,'{events}',coalesce((select jsonb_agg(
    jsonb_set(e.value,'{sequence}',to_jsonb(coalesce(h.sequence,(e.value->>'sequence')::integer))) order by e.ordinality)
    from jsonb_array_elements(base.v->'events') with ordinality e(value,ordinality)
    left join lateral (select ph.sequence from private.calendar_publication_history ph
      where ph.event_id=substring(e.value->>'uid' from 1 for 36)::uuid
        and ph.logical_occurrence_id=substring(e.value->>'uid' from 38 for 36)::uuid
      order by ph.sequence desc limit 1) h on true),'[]'::jsonb))
  from (select private.calendar_public_occurrences(p_from,p_to,p_limit,p_offset) v) base;
$$;
revoke all on function public.calendar_public_occurrences(date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.calendar_public_occurrences(date,date,integer,integer) to anon,authenticated;

alter function public.calendar_public_occurrence(uuid,uuid) set schema private;
revoke all on function private.calendar_public_occurrence(uuid,uuid) from public,anon,authenticated,service_role;
create function public.calendar_public_occurrence(p_event uuid,p_occurrence uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when base.v is null then null else jsonb_set(base.v,'{sequence}',
    to_jsonb(coalesce((select h.sequence from private.calendar_publication_history h
      where h.event_id=p_event and h.logical_occurrence_id=p_occurrence order by h.sequence desc limit 1),
      (base.v->>'sequence')::integer))) end
  from (select private.calendar_public_occurrence(p_event,p_occurrence) v) base;
$$;
revoke all on function public.calendar_public_occurrence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.calendar_public_occurrence(uuid,uuid) to anon,authenticated;

-- Synchronization feeds include retained cancellations; the regular website RPC
-- above intentionally does not. A current rolling subscription also includes
-- retained cancellations whose former time is outside its requested range.
create function public.calendar_public_sync_feed(p_from date,p_to date,p_limit integer default 200,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare zone text; starts timestamptz; ends timestamptz; output jsonb;
begin
  if p_from is null or p_to is null or not isfinite(p_from) or not isfinite(p_to)
    or p_to<p_from or p_to-p_from>365 or p_limit is null or p_limit<1 or p_limit>5000
    or p_offset is null or p_offset<0 or p_offset>100000 then
    raise exception 'Invalid public calendar range or page.' using errcode='RAR10';
  end if;
  select timezone into zone from public.app_settings where id;
  starts:=p_from::timestamp at time zone zone;
  ends:=(p_to+1)::timestamp at time zone zone;
  with latest as materialized (
    select distinct on (event_id,logical_occurrence_id) * from private.calendar_publication_history
    order by event_id,logical_occurrence_id,sequence desc
  ), candidates as (
    select o.start_at sort_at,s.event_id,o.logical_occurrence_id,
      jsonb_build_object('status','published',
        'uid',s.event_id::text || '-' || o.logical_occurrence_id::text || '@reservearoom.stonehillchurch.org',
        'title',s.title,'description',s.public_description,
        'location',case s.location_type when 'church' then (select church_name from public.app_settings where id)
          when 'virtual' then 'Online' when 'offsite' then 'Offsite' else null end,
        'starts_at',o.start_at,'ends_at',o.end_at,'local_start_date',o.local_start::date,'local_end_date',o.local_end::date,
        'timezone',o.timezone,'all_day',o.all_day,'sequence',coalesce(h.sequence,s.plan_revision),
        'last_modified',coalesce(h.changed_at,cm.approved_at)) value
    from public.calendar_event_commitments cm
    join public.calendar_event_submissions s on s.id=cm.submission_id and s.event_id=cm.event_id
    join public.calendar_submission_occurrences o on o.submission_id=s.id
    left join latest h on h.event_id=s.event_id and h.logical_occurrence_id=o.logical_occurrence_id
      and h.status='published' and h.commitment_id=cm.id
    where cm.state='active' and s.visibility='public' and o.event_range && tstzrange(starts,ends,'[)')
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
        where cc.commitment_id=cm.id and cc.logical_occurrence_id=o.logical_occurrence_id)
    union all
    select h.start_at,h.event_id,h.logical_occurrence_id,
      jsonb_build_object('status','cancelled',
        'uid',h.event_id::text || '-' || h.logical_occurrence_id::text || '@reservearoom.stonehillchurch.org',
        'sequence',h.sequence,'last_modified',h.changed_at,'starts_at',h.start_at,'ends_at',h.end_at,
        'local_start_date',h.local_start_date,'local_end_date',h.local_end_date,'timezone',h.timezone,'all_day',h.all_day)
    from latest h where h.status='cancelled'
      and now()<greatest(h.changed_at+interval '90 days',h.end_at+interval '30 days')
      and (tstzrange(h.start_at,h.end_at,'[)') && tstzrange(starts,ends,'[)') or (now()>=starts and now()<ends))
  ), page as materialized (
    select * from candidates order by sort_at,event_id,logical_occurrence_id offset p_offset limit p_limit+1
  ), numbered as (select page.*,row_number() over (order by sort_at,event_id,logical_occurrence_id) n from page)
  select jsonb_build_object('version',1,'timezone',zone,'has_more',count(*)>p_limit,
    'events',coalesce(jsonb_agg(value order by n) filter(where n<=p_limit),'[]'::jsonb)) into output from numbered;
  return output;
end;
$$;
revoke all on function public.calendar_public_sync_feed(date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.calendar_public_sync_feed(date,date,integer,integer) to anon,authenticated;
