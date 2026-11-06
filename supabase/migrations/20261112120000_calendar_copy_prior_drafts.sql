-- Copy semantic information only. No old dates, requests, commitments, decisions,
-- occurrence identities, or contacts are assumed valid for a new cycle.
alter table public.calendar_events
  add column copied_from_submission_id uuid references public.calendar_event_submissions(id),
  add column copied_date_review_required boolean not null default false,
  add column copied_date_reviewed_version integer;
create unique index calendar_copied_submission_once on public.calendar_events(plan_id,copied_from_submission_id)
  where copied_from_submission_id is not null;

create function public.calendar_copy_prior_plan(p_source uuid,p_target uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_super_admin(); source_plan public.ministry_calendar_plans;
  target_plan public.ministry_calendar_plans; source_cycle public.calendar_cycles; target_cycle public.calendar_cycles;
  s public.calendar_event_submissions; new_event uuid; n integer:=0; zone text;
begin
  select c.* into target_cycle from public.calendar_cycles c join public.ministry_calendar_plans p on p.cycle_id=c.id
    where p.id=p_target for update of c;
  select * into target_plan from public.ministry_calendar_plans where id=p_target for update;
  select * into source_plan from public.ministry_calendar_plans where id=p_source;
  select * into source_cycle from public.calendar_cycles where id=source_plan.cycle_id;
  if target_plan.id is null or source_plan.id is null or p_source=p_target
    or not target_plan.active or target_plan.submission_status<>'draft' or target_plan.submission_revision<>0
    or target_cycle.status not in ('draft','open') or source_plan.ministry_id<>target_plan.ministry_id
    or source_plan.submission_revision=0 or source_cycle.start_date>=target_cycle.start_date then
    raise exception 'Plans cannot be copied into this cycle.' using errcode='RAR09';
  end if;
  select timezone into zone from public.app_settings where id;
  for s in select x.* from public.calendar_event_submissions x
    join public.calendar_events e on e.id=x.event_id
    where e.plan_id=source_plan.id and x.plan_revision=source_plan.submission_revision order by x.id
  loop
    new_event:=null;
    insert into public.calendar_events(plan_id,title,description,public_description,category,scope,protection,visibility,
      location_type,offsite_location,virtual_url,estimated_attendance,food_drinks_planned,setup_minutes,cleanup_minutes,
      requester_notes,copied_from_submission_id,copied_date_review_required)
    values(target_plan.id,s.title,s.description,s.public_description,s.category,s.scope,s.protection,s.visibility,
      s.location_type,s.offsite_location,s.virtual_url,s.estimated_attendance,s.food_drinks_planned,s.setup_minutes,s.cleanup_minutes,
      s.requester_notes,s.id,true) on conflict do nothing returning id into new_event;
    if new_event is not null then
      insert into public.calendar_event_schedules(event_id,kind,timezone,start_date,end_date,start_time,end_time,all_day)
        values(new_event,'one_time',zone,null,null,null,null,s.all_day);
      n:=n+1;
    end if;
  end loop;
  perform private.calendar_audit(actor,'calendar_plan.copied','calendar_plan',target_plan.id,
    jsonb_build_object('source_plan_id',source_plan.id,'copied_events',n));
  return n;
end;
$$;
revoke execute on function public.calendar_copy_prior_plan(uuid,uuid) from public,anon,service_role;
grant execute on function public.calendar_copy_prior_plan(uuid,uuid) to authenticated;

create function public.calendar_confirm_copied_date_review(p_plan_id uuid,p_session_hash text,p_event_id uuid,p_expected_version integer)
returns void language plpgsql security definer set search_path='' as $$
declare ctx jsonb; e public.calendar_events; s public.calendar_event_schedules;
begin
  ctx:=private.calendar_require_planner(p_plan_id,p_session_hash,true);
  select * into e from public.calendar_events where id=p_event_id and plan_id=(ctx->>'plan_id')::uuid for update;
  select * into s from public.calendar_event_schedules where event_id=e.id;
  if e.id is null or not e.copied_date_review_required or e.deleted_at is not null
    or e.draft_version is distinct from p_expected_version or s.start_date is null or s.end_date is null
    or not exists(select 1 from public.ministry_calendar_plans p where p.id=e.plan_id and p.active
      and p.submission_status in ('draft','changes_requested')) then
    raise exception 'Save and review the copied event dates first.' using errcode='RAR09';
  end if;
  update public.calendar_events set copied_date_reviewed_version=draft_version where id=e.id;
  insert into public.audit_logs(actor_kind,action,entity_type,entity_id,metadata)
    values('guest','calendar_event.copy_dates_reviewed','calendar_event',e.id::text,
      jsonb_build_object('plan_id',e.plan_id,'grant_id',ctx->>'grant_id','draft_version',e.draft_version));
end;
$$;
revoke execute on function public.calendar_confirm_copied_date_review(uuid,text,uuid,integer) from public,anon,authenticated;
grant execute on function public.calendar_confirm_copied_date_review(uuid,text,uuid,integer) to service_role;

-- Preserve the existing serialization and submission validation; add an
-- independent server-side review gate before the original transaction runs.
alter function public.calendar_submit_plan(uuid,text,text,boolean) rename to calendar_submit_plan_before_copy_review;
revoke execute on function public.calendar_submit_plan_before_copy_review(uuid,text,text,boolean) from public,anon,authenticated,service_role;
create function public.calendar_submit_plan(p_plan_id uuid,p_session_hash text,p_message text,p_confirm_empty boolean)
returns integer language plpgsql security definer set search_path='' as $$
declare ctx jsonb;
begin
  if not private.is_calendar_service() then raise exception 'Planning access unavailable.' using errcode='RAR09'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reserve_a_room.calendar_approval',0));
  ctx:=private.calendar_require_planner(p_plan_id,p_session_hash,true);
  if exists(select 1 from public.calendar_events e where e.plan_id=(ctx->>'plan_id')::uuid and e.deleted_at is null
    and e.copied_date_review_required and e.copied_date_reviewed_version is distinct from e.draft_version) then
    raise exception 'Review and confirm dates for every copied event before submitting.' using errcode='RAR09';
  end if;
  return public.calendar_submit_plan_before_copy_review(p_plan_id,p_session_hash,p_message,p_confirm_empty);
end;
$$;
revoke execute on function public.calendar_submit_plan(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.calendar_submit_plan(uuid,text,text,boolean) to service_role;

-- Duplicating a copied draft cannot evade the explicit review gate. A separate
-- flag is used so the one-copy-per-source provenance key remains meaningful.
alter function public.calendar_duplicate_event_draft(uuid,text,uuid) rename to calendar_duplicate_event_before_copy_review;
revoke execute on function public.calendar_duplicate_event_before_copy_review(uuid,text,uuid) from public,anon,authenticated,service_role;
create function public.calendar_duplicate_event_draft(p_plan_id uuid,p_session_hash text,p_event_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; needs_review boolean;
begin
  select copied_date_review_required into needs_review from public.calendar_events where id=p_event_id;
  result:=public.calendar_duplicate_event_before_copy_review(p_plan_id,p_session_hash,p_event_id);
  if needs_review then update public.calendar_events set copied_date_review_required=true where id=result; end if;
  return result;
end;
$$;
revoke execute on function public.calendar_duplicate_event_draft(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.calendar_duplicate_event_draft(uuid,text,uuid) to service_role;
