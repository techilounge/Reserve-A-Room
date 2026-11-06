-- The staff dashboard reports aggregate planning progress; it does not expose
-- planner contacts, access tokens, notes, or draft event content.
create function public.calendar_planning_dashboard() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return (
    with conflicts as materialized (select * from private.calendar_current_conflicts()),
    conflict_events as (
      select c.fingerprint,c.classification,c.event_id as id from conflicts c
      union select c.fingerprint,c.classification,c.other_event_id from conflicts c where c.other_event_id is not null
      union select c.fingerprint,c.classification,(p.value->>'event_id')::uuid from conflicts c
        cross join lateral jsonb_array_elements(case when jsonb_typeof(c.details->'participants')='array'
          then c.details->'participants' else '[]'::jsonb end) p(value)
        where (p.value->>'event_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ), plan_progress as (
      select p.id,p.cycle_id,m.name as ministry,p.submission_status,p.submission_revision,p.submitted_at,
        exists(select 1 from public.calendar_plan_access a where a.plan_id=p.id and a.revoked_at is null and a.expires_at>now()) as invited,
        (select count(*) from public.calendar_events e where e.plan_id=p.id and e.deleted_at is null) as events,
        (select count(*) from public.calendar_events e join public.calendar_event_commitments cm on cm.event_id=e.id and cm.state='active'
          where e.plan_id=p.id) as approved,
        (select count(distinct ce.fingerprint) from conflict_events ce join public.calendar_events e on e.id=ce.id where e.plan_id=p.id) as conflicts
      from public.ministry_calendar_plans p join public.ministries m on m.id=p.ministry_id where p.active
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',cy.id,'name',cy.name,'status',cy.status,'start_date',cy.start_date,'end_date',cy.end_date,
      'submission_deadline',cy.submission_deadline,
      'invited',(select count(*) from plan_progress p where p.cycle_id=cy.id and p.invited),
      'submitted',(select count(*) from plan_progress p where p.cycle_id=cy.id and p.submission_status='submitted'),
      'outstanding',(select count(*) from plan_progress p where p.cycle_id=cy.id and p.submission_status<>'submitted'),
      'events',(select coalesce(sum(p.events),0) from plan_progress p where p.cycle_id=cy.id),
      'approved',(select coalesce(sum(p.approved),0) from plan_progress p where p.cycle_id=cy.id),
      'changes_requested',(select count(*) from plan_progress p where p.cycle_id=cy.id and p.submission_status='changes_requested'),
      'hard_conflicts',(select count(distinct ce.fingerprint) from conflict_events ce join public.calendar_events e on e.id=ce.id
        join public.ministry_calendar_plans p on p.id=e.plan_id where p.cycle_id=cy.id and p.active and ce.classification='hard'),
      'planning_conflicts',(select count(distinct ce.fingerprint) from conflict_events ce join public.calendar_events e on e.id=ce.id
        join public.ministry_calendar_plans p on p.id=e.plan_id where p.cycle_id=cy.id and p.active and ce.classification='planning'),
      'warnings',(select count(distinct ce.fingerprint) from conflict_events ce join public.calendar_events e on e.id=ce.id
        join public.ministry_calendar_plans p on p.id=e.plan_id where p.cycle_id=cy.id and p.active and ce.classification='warning'),
      'ministries',(select coalesce(jsonb_agg(to_jsonb(p)-'cycle_id' order by p.ministry,p.id),'[]'::jsonb) from plan_progress p where p.cycle_id=cy.id)
    ) order by cy.start_date desc,cy.id),'[]'::jsonb) from public.calendar_cycles cy
  );
end;
$$;
revoke execute on function public.calendar_planning_dashboard() from public,anon,service_role;
grant execute on function public.calendar_planning_dashboard() to authenticated;
