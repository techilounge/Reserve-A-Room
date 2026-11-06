-- Public read model: only explicitly approved, public, uncancelled occurrences
-- from the current immutable commitment. Never expose operational or planner data.
create function public.calendar_public_occurrences(p_from date,p_to date,p_limit integer default 200,p_offset integer default 0)
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
  with items as materialized (
    select s.event_id,o.logical_occurrence_id,s.title,s.public_description,s.location_type,o.start_at,o.end_at,
      o.local_start::date as local_start_date,o.local_end::date as local_end_date,o.timezone,o.all_day,
      cm.approved_at,s.plan_revision
    from public.calendar_event_commitments cm
    join public.calendar_event_submissions s on s.id=cm.submission_id and s.event_id=cm.event_id
    join public.calendar_submission_occurrences o on o.submission_id=s.id
    where cm.state='active' and s.visibility='public'
      and o.event_range && tstzrange(starts,ends,'[)')
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
        where cc.commitment_id=cm.id and cc.logical_occurrence_id=o.logical_occurrence_id)
    order by o.start_at,s.event_id,o.logical_occurrence_id
    offset p_offset limit p_limit+1
  ), numbered as (select i.*,row_number() over (order by i.start_at,i.event_id,i.logical_occurrence_id) n from items i)
  select jsonb_build_object('version',1,'timezone',zone,'has_more',count(*)>p_limit,
    'events',coalesce(jsonb_agg(jsonb_build_object(
      'uid',event_id::text || '-' || logical_occurrence_id::text || '@reservearoom.stonehillchurch.org',
      'title',title,'description',public_description,
      'location',case location_type when 'church' then (select church_name from public.app_settings where id) when 'virtual' then 'Online' when 'offsite' then 'Offsite' else null end,
      'starts_at',start_at,'ends_at',end_at,
      'local_start_date',local_start_date,'local_end_date',local_end_date,'timezone',timezone,'all_day',all_day,
      'sequence',plan_revision,'last_modified',approved_at
    ) order by n) filter (where n<=p_limit),'[]'::jsonb)) into output from numbered;
  return output;
end;
$$;
revoke execute on function public.calendar_public_occurrences(date,date,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.calendar_public_occurrences(date,date,integer,integer) to anon,authenticated;

-- Stable detail URLs resolve the exact logical occurrence only while it remains
-- approved, public and uncancelled. No historical or cancellation data is exposed.
create function public.calendar_public_occurrence(p_event uuid,p_occurrence uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'uid',s.event_id::text || '-' || o.logical_occurrence_id::text || '@reservearoom.stonehillchurch.org',
    'title',s.title,'description',s.public_description,
    'location',case s.location_type when 'church' then (select church_name from public.app_settings where id) when 'virtual' then 'Online' when 'offsite' then 'Offsite' else null end,
    'starts_at',o.start_at,'ends_at',o.end_at,
    'local_start_date',o.local_start::date,'local_end_date',o.local_end::date,'timezone',o.timezone,'all_day',o.all_day,
    'sequence',s.plan_revision,'last_modified',cm.approved_at)
  from public.calendar_event_commitments cm
  join public.calendar_event_submissions s on s.id=cm.submission_id and s.event_id=cm.event_id
  join public.calendar_submission_occurrences o on o.submission_id=s.id
  where cm.state='active' and s.visibility='public' and s.event_id=p_event and o.logical_occurrence_id=p_occurrence
    and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
      where cc.commitment_id=cm.id and cc.logical_occurrence_id=o.logical_occurrence_id)
  limit 1;
$$;
revoke execute on function public.calendar_public_occurrence(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.calendar_public_occurrence(uuid,uuid) to anon,authenticated;
