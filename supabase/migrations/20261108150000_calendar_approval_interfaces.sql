-- Provisional interfaces. The mutation functions are intentionally ungranted
-- until the entire Phase 6 implementation and native concurrency tests pass.
create function public.calendar_approve_event(p_event_id uuid,p_expected_revision integer,
  p_first_name text,p_last_name text,p_phone text,p_expected_commitment uuid default null)
returns uuid language sql security definer set search_path = '' as $$
  select private.calendar_approve_initial(p_event_id,p_expected_revision,p_first_name,p_last_name,p_phone,p_expected_commitment);
$$;
create function public.calendar_cancel_event(p_event_id uuid,p_expected_commitment uuid,p_reason text)
returns void language sql security definer set search_path = '' as $$
  select private.calendar_cancel_commitment(p_event_id,p_expected_commitment,p_reason);
$$;
revoke execute on function public.calendar_approve_event(uuid,integer,text,text,text,uuid),
  public.calendar_cancel_event(uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.calendar_staff_active_commitments()
returns table(id uuid,event_id uuid,submission_id uuid,title text,ministry text,cycle text,plan_active boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select cm.id,cm.event_id,cm.submission_id,s.title,m.name,cy.name,p.active
    from public.calendar_event_commitments cm join public.calendar_event_submissions s on s.id=cm.submission_id
    join public.calendar_events e on e.id=cm.event_id join public.ministry_calendar_plans p on p.id=e.plan_id
    join public.ministries m on m.id=p.ministry_id join public.calendar_cycles cy on cy.id=p.cycle_id
    where cm.state='active' order by cy.name,m.name,s.title,cm.id;
end;
$$;
revoke execute on function public.calendar_staff_active_commitments() from public,anon,service_role;
grant execute on function public.calendar_staff_active_commitments() to authenticated;

create function public.calendar_staff_latest_commitments()
returns table(id uuid,event_id uuid,submission_id uuid,state text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select distinct on (cm.event_id) cm.id,cm.event_id,cm.submission_id,cm.state
    from public.calendar_event_commitments cm order by cm.event_id,cm.approval_order desc;
end;
$$;
revoke execute on function public.calendar_staff_latest_commitments() from public,anon,service_role;
grant execute on function public.calendar_staff_latest_commitments() to authenticated;

-- Linked holds never use ordinary guest/reservation emails. This also prevents
-- the ordinary retry_email RPC from retrying a forged or legacy linked message.
create function private.guard_calendar_reservation_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.reservations where id=new.reservation_id and calendar_commitment_id is not null) then
    raise exception 'Calendar reservations use calendar notifications.' using errcode='RAR09';
  end if;
  return new;
end;
$$;
create trigger email_logs_calendar_guard before insert or update on public.email_logs
  for each row execute function private.guard_calendar_reservation_email();
revoke execute on function private.guard_calendar_reservation_email() from public,anon,authenticated,service_role;
