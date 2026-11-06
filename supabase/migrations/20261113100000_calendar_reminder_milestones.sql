-- A single milestone calculation is shared by queueing and delivery. The
-- caller supplies the transaction's current time so boundary behavior agrees.
create function private.calendar_reminder_milestone(p_deadline timestamptz,p_now timestamptz)
returns text language sql immutable strict set search_path='' as $$
  select case when p_now>=p_deadline then 'overdue'
    when p_now>=p_deadline-interval '7 days' then 'days7'
    when p_now>=p_deadline-interval '14 days' then 'days14'
    when p_now>=p_deadline-interval '30 days' then 'days30'
    else 'opened' end;
$$;
revoke all on function private.calendar_reminder_milestone(timestamptz,timestamptz) from public,anon,authenticated,service_role;

create or replace function public.calendar_queue_due_reminders(p_limit integer default 50) returns integer
language plpgsql security definer set search_path='' as $$
declare r record; v_id uuid; v_count integer:=0;
begin
  if not private.is_calendar_service() then raise exception 'Not authorized.' using errcode='RAR09'; end if;
  if p_limit is null or p_limit<1 or p_limit>100 then raise exception 'Invalid limit.' using errcode='RAR10'; end if;
  for r in
    select p.id as plan_id,a.id as grant_id,a.version,a.contact_email,c.reminder_revision,c.submission_deadline,
      private.calendar_reminder_milestone(c.submission_deadline,now()) as kind
    from public.ministry_calendar_plans p join public.calendar_cycles c on c.id=p.cycle_id
      join public.calendar_plan_access a on a.plan_id=p.id
    where p.active and p.submission_status in ('draft','changes_requested') and c.status='open'
      and c.submission_opens_at<=now() and c.submission_deadline>now()-interval '7 days'
      and a.revoked_at is null and (a.expires_at>now() or (now()>=c.submission_deadline and a.expires_at>=c.submission_deadline))
      and not exists(select 1 from public.calendar_plan_reminders x where x.plan_id=p.id and x.grant_id=a.id
        and x.grant_version=a.version and x.deadline_revision=c.reminder_revision
        and x.kind=private.calendar_reminder_milestone(c.submission_deadline,now()))
    order by c.submission_deadline,p.id,a.id limit p_limit
  loop
    v_id:=null;
    insert into public.calendar_plan_reminders(plan_id,grant_id,grant_version,deadline_revision,kind,deadline)
      values (r.plan_id,r.grant_id,r.version,r.reminder_revision,r.kind,r.submission_deadline)
      on conflict do nothing returning id into v_id;
    if v_id is not null then
      perform private.queue_system_email(r.contact_email,'calendar_plan_reminder','calendar_plan_reminder',v_id);
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- A previously queued email is skipped once its milestone or delivery window
-- is stale, including on the first attempt following an extended outage.
create or replace function public.calendar_reminder_context(p_email_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('contact_name',a.contact_name,'ministry',m.name,'cycle',c.name,
    'deadline',r.deadline,'kind',r.kind,'created_at',r.created_at)
  from public.system_email_logs e join public.calendar_plan_reminders r on r.id=e.entity_id
  join public.calendar_plan_access a on a.id=r.grant_id and a.plan_id=r.plan_id and a.version=r.grant_version
  join public.ministry_calendar_plans p on p.id=r.plan_id
  join public.calendar_cycles c on c.id=p.cycle_id and c.reminder_revision=r.deadline_revision
  join public.ministries m on m.id=p.ministry_id
  where private.is_calendar_service() and e.id=p_email_id and e.event_type='calendar_plan_reminder'
    and e.entity_type='calendar_plan_reminder' and e.recipient=lower(btrim(a.contact_email))
    and p.active and p.submission_status in ('draft','changes_requested') and c.status='open'
    and c.submission_opens_at<=now() and c.submission_deadline>now()-interval '7 days'
    and r.deadline=c.submission_deadline
    and r.kind=private.calendar_reminder_milestone(c.submission_deadline,now())
    and a.revoked_at is null and (a.expires_at>now() or (r.kind='overdue' and a.expires_at>=r.deadline));
$$;
