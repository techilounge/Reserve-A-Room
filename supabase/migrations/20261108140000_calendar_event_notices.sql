-- Durable, idempotent event-level notifications. These are queued inside the
-- calendar transaction and delivered separately by the branded Resend worker.
alter table public.notifications drop constraint notifications_type_valid;
alter table public.notifications add constraint notifications_type_valid check (type in (
  'reservation_pending','reservation_cancelled_by_requester','reservation_modified',
  'reservation_approved','reservation_declined','email_failed','recurring_request_received','calendar_event','calendar_plan'
));

create table private.calendar_event_notice_batches (
  id uuid primary key default gen_random_uuid(),
  commitment_id uuid not null references public.calendar_event_commitments(id),
  action text not null check (action in ('approved','replaced','cancelled','occurrence_cancelled')),
  occurrence_id uuid references public.calendar_submission_occurrences(id),
  created_at timestamptz not null default now(),
  check ((action='occurrence_cancelled') = (occurrence_id is not null))
);
create unique index calendar_event_notice_batches_once on private.calendar_event_notice_batches
  (commitment_id,action,coalesce(occurrence_id,'00000000-0000-0000-0000-000000000000'::uuid));
revoke all on private.calendar_event_notice_batches from public,anon,authenticated,service_role;

create function private.queue_calendar_event_notice(p_commitment uuid,p_action text,p_actor uuid,p_reason text,p_occurrence uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_batch uuid; v_data record; v_payload jsonb; v_recipient text; v_title text;
begin
  if p_action not in ('approved','replaced','cancelled','occurrence_cancelled') or (p_action='occurrence_cancelled')<>(p_occurrence is not null) then raise exception 'Invalid calendar notice.' using errcode='RAR09'; end if;
  select c.id,s.title,s.plan_revision,p.id as plan_id,m.name as ministry,cy.name as cycle,
    occ.start_at as occurrence_start,occ.end_at as occurrence_end,occ.timezone as occurrence_timezone
    into v_data from public.calendar_event_commitments c
    join public.calendar_event_submissions s on s.id=c.submission_id
    join public.calendar_events e on e.id=c.event_id join public.ministry_calendar_plans p on p.id=e.plan_id
    join public.ministries m on m.id=p.ministry_id join public.calendar_cycles cy on cy.id=p.cycle_id
    left join public.calendar_submission_occurrences occ on occ.id=p_occurrence and occ.submission_id=c.submission_id
    where c.id=p_commitment and ((p_action='cancelled' and c.state='cancelled') or (p_action in ('approved','replaced','occurrence_cancelled') and c.state='active'))
      and (p_occurrence is null or (occ.id is not null and exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=c.id and cc.submission_occurrence_id=occ.id)));
  if not found then raise exception 'Calendar notice context unavailable.' using errcode='RAR09'; end if;
  insert into private.calendar_event_notice_batches(commitment_id,action,occurrence_id) values(p_commitment,p_action,p_occurrence)
    on conflict do nothing returning id into v_batch;
  if v_batch is null then return; end if;
  v_payload:=jsonb_build_object('calendar_notice',jsonb_build_object('action',p_action,'event_title',v_data.title,
    'ministry',v_data.ministry,'cycle',v_data.cycle,'revision',v_data.plan_revision,
    'reason',p_reason,'occurrence_start',v_data.occurrence_start,'occurrence_end',v_data.occurrence_end,
    'occurrence_timezone',v_data.occurrence_timezone,'created_at',now()));
  for v_recipient in select contact_email from public.calendar_plan_access where plan_id=v_data.plan_id and revoked_at is null
    union select recipient from private.staff_email_recipients() as recipient loop
    perform private.queue_system_email(v_recipient,'calendar_event_'||p_action,'calendar_event_notice',v_batch,v_payload);
  end loop;
  v_title:=case p_action when 'approved' then 'Calendar event approved' when 'replaced' then 'Calendar event updated' when 'occurrence_cancelled' then 'Calendar event date cancelled' else 'Calendar event cancelled' end;
  perform private.notify_other_staff(p_actor,'calendar_event',v_title,left(v_data.title || ' · ' || v_data.ministry,1000),null);
end;
$$;
revoke execute on function private.queue_calendar_event_notice(uuid,text,uuid,text,uuid) from public,anon,authenticated,service_role;

-- A plan revision can be submitted and then sent back for changes once each.
-- Versioned batches make repeated trigger execution idempotent.
create table private.calendar_plan_notice_batches (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.ministry_calendar_plans(id),
  revision integer not null,
  action text not null check (action in ('submitted','changes_requested')),
  created_at timestamptz not null default now(),
  unique(plan_id,revision,action)
);
revoke all on private.calendar_plan_notice_batches from public,anon,authenticated,service_role;

create function private.calendar_queue_plan_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_action text; v_batch uuid; v_ministry text; v_cycle text; v_payload jsonb; v_recipient text;
begin
  if new.submission_status='submitted' and new.submission_revision<>old.submission_revision then
    v_action:='submitted';
  elsif new.submission_status='changes_requested' and old.submission_status='submitted' then
    v_action:='changes_requested';
  else return new; end if;
  insert into private.calendar_plan_notice_batches(plan_id,revision,action)
    values(new.id,new.submission_revision,v_action) on conflict(plan_id,revision,action) do nothing returning id into v_batch;
  if v_batch is null then return new; end if;
  select m.name,c.name into v_ministry,v_cycle from public.ministries m,public.calendar_cycles c
    where m.id=new.ministry_id and c.id=new.cycle_id;
  v_payload:=jsonb_build_object('calendar_notice',jsonb_build_object('action',v_action,'ministry',v_ministry,
    'cycle',v_cycle,'revision',new.submission_revision,'reason',case when v_action='changes_requested' then new.changes_requested_reason end,'created_at',now()));
  if v_action='submitted' then
    for v_recipient in select recipient from private.staff_email_recipients() as recipient loop
      perform private.queue_system_email(v_recipient,'calendar_plan_submitted','calendar_plan_notice',v_batch,v_payload);
    end loop;
    perform private.notify_staff('calendar_plan','Church calendar plan submitted',left(v_ministry || ' · ' || v_cycle,1000),null);
  else
    for v_recipient in select contact_email from public.calendar_plan_access where plan_id=new.id and revoked_at is null loop
      perform private.queue_system_email(v_recipient,'calendar_plan_changes_requested','calendar_plan_notice',v_batch,v_payload);
    end loop;
  end if;
  return new;
end;
$$;
create trigger calendar_queue_plan_notice after update of submission_status,submission_revision on public.ministry_calendar_plans
  for each row execute function private.calendar_queue_plan_notice();
revoke execute on function private.calendar_queue_plan_notice() from public,anon,authenticated,service_role;

-- A failed provider retry must not create one staff alert per attempt for the
-- same calendar notice. Other system-email behavior remains unchanged.
create table private.calendar_email_failure_notices (
  email_id uuid primary key references public.system_email_logs(id),
  created_at timestamptz not null default now()
);
revoke all on private.calendar_email_failure_notices from public,anon,authenticated,service_role;
create or replace function public.complete_system_email(p_id uuid,p_status public.email_status,
  p_provider_message_id text default null,p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_email public.system_email_logs; v_first uuid;
begin
  if p_status not in ('sent','failed','skipped') then raise exception 'Invalid email status.' using errcode='RAR10'; end if;
  update public.system_email_logs set status=p_status,provider_message_id=coalesce(p_provider_message_id,provider_message_id),
    error_message=case when p_status='failed' then left(p_error,500) else null end,
    sent_at=case when p_status='sent' then now() else sent_at end where id=p_id returning * into v_email;
  if p_status='failed' then
    if v_email.event_type like 'calendar_event_%' or v_email.event_type like 'calendar_plan_%' then
      insert into private.calendar_email_failure_notices(email_id) values(p_id) on conflict(email_id) do nothing returning email_id into v_first;
      if v_first is null then return; end if;
    end if;
    perform private.notify_staff('email_failed','System email not delivered',
      'An email to ' || v_email.recipient || ' could not be sent. Review the related record.',null);
  end if;
end;
$$;
