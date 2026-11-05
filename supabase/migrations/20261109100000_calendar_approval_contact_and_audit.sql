-- Determine requirements from effective immutable occurrence requests, not templates.
create function private.calendar_submission_needs_room_contact(p_submission uuid,p_previous uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.calendar_submission_occurrences o
    join public.calendar_submission_room_requests rr on rr.submission_occurrence_id=o.id
    where o.submission_id=p_submission and o.occupancy_start>now()
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
        where cc.commitment_id=p_previous and cc.logical_occurrence_id=o.logical_occurrence_id));
$$;
revoke execute on function private.calendar_submission_needs_room_contact(uuid,uuid) from public,anon,authenticated,service_role;

-- Staff-only display hint; the approval transaction independently rechecks it.
create function public.calendar_staff_room_contact_requirements()
returns table(submission_id uuid,requires_room_contact boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select s.id,private.calendar_submission_needs_room_contact(s.id,c.id)
    from public.calendar_event_submissions s
    join public.calendar_events e on e.id=s.event_id
    join public.ministry_calendar_plans p on p.id=e.plan_id
    left join public.calendar_event_commitments c on c.event_id=e.id and c.state='active'
    where p.active and p.submission_status='submitted' and s.plan_revision=p.submission_revision;
end;
$$;
revoke execute on function public.calendar_staff_room_contact_requirements() from public,anon,service_role;
grant execute on function public.calendar_staff_room_contact_requirements() to authenticated;

create or replace function private.calendar_approve_initial(p_event_id uuid,p_expected_revision integer,
  p_first_name text,p_last_name text,p_phone text,p_expected_commitment uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := private.require_staff(); v_event public.calendar_events;
  v_plan public.ministry_calendar_plans; v_cycle public.calendar_cycles;
  v_submission public.calendar_event_submissions; v_grant public.calendar_plan_access;
  v_previous public.calendar_event_commitments;
  v_commitment uuid; v_reservation uuid; v_attempt integer; v_reference text;
  v_conflict record; v_decision public.calendar_conflict_decisions; v_item record; v_bypass_used boolean := false;
begin
  -- Serialize competing approvals, including exclusive events with no room.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reserve_a_room.calendar_approval',0));
  update private.calendar_commitment_serialization set revision=revision+1 where id;
  perform 1 from public.app_settings where id for share;
  -- Lock all existing calendar participants in deterministic order. This broad
  -- first implementation favors correctness over concurrency; measure before release.
  perform 1 from public.calendar_cycles order by id for update;
  perform 1 from public.ministry_calendar_plans order by id for update;
  perform 1 from public.calendar_events order by id for update;
  -- Decision writers lock cycle/plan/event before inserting. Acquire this table
  -- lock after those rows, preserving their lock order and preventing a newer
  -- decision from superseding the one checked before this transaction finishes.
  lock table public.calendar_conflict_decisions in share mode;
  select * into v_event from public.calendar_events where id=p_event_id;
  if not found then raise exception 'Calendar event not found.' using errcode='RAR09'; end if;
  select * into v_plan from public.ministry_calendar_plans where id=v_event.plan_id;
  select * into v_cycle from public.calendar_cycles where id=v_plan.cycle_id;
  if not v_plan.active or v_plan.submission_status<>'submitted' or v_cycle.status not in ('open','review')
    or v_event.status<>'submitted' or v_event.deleted_at is not null
    or p_expected_revision is distinct from v_plan.submission_revision or v_event.revision<>p_expected_revision
    or p_expected_revision<=v_plan.resource_submission_floor then
    raise exception 'The submission changed or is no longer eligible for approval.' using errcode='RAR09';
  end if;
  select * into v_submission from public.calendar_event_submissions where event_id=p_event_id and plan_revision=p_expected_revision;
  if not found or not exists(select 1 from public.calendar_submission_occurrences where submission_id=v_submission.id) then
    raise exception 'The submission cannot be approved; refresh the calendar.' using errcode='RAR09';
  end if;
  if exists(select 1 from public.calendar_event_commitments where submission_id=v_submission.id and state in ('cancelled','replaced')) then
    raise exception 'A fresh submission is required before approving this event again.' using errcode='RAR09';
  end if;
  select * into v_previous from public.calendar_event_commitments where event_id=p_event_id and state='active' for update;
  -- A retry of the same initial approval returns the already-created result;
  -- no holds, allocations or notices are queued twice.
  if p_expected_commitment is null and v_previous.id is not null and v_previous.submission_id=v_submission.id then
    return v_previous.id;
  end if;
  if (p_expected_commitment is null and v_previous.id is not null)
    or (p_expected_commitment is not null and v_previous.id is distinct from p_expected_commitment)
    or (v_previous.id is not null and v_previous.submission_id=v_submission.id) then
    raise exception 'The existing approval changed; refresh the calendar.' using errcode='RAR09';
  end if;
  if private.calendar_submission_needs_room_contact(v_submission.id,v_previous.id) and (
    char_length(btrim(coalesce(p_first_name,''))) not between 1 and 80
    or char_length(btrim(coalesce(p_last_name,''))) not between 1 and 80
    or coalesce(p_phone,'') !~ '^\+[1-9][0-9]{6,14}$') then
    raise exception 'A valid contact name and international phone number are required for room holds.' using errcode='RAR11';
  end if;
  select * into v_grant from public.calendar_plan_access where id=v_submission.submitted_by_grant;
  if not private.is_valid_email(v_grant.contact_email) then raise exception 'The planner email is unavailable.' using errcode='RAR10'; end if;
  if v_submission.estimated_attendance>10000 then raise exception 'Attendance exceeds the reservation limit.' using errcode='RAR10'; end if;
  if not exists(select 1 from public.calendar_submission_occurrences candidate where candidate.submission_id=v_submission.id and candidate.occupancy_start>now()
    and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cancelled where cancelled.commitment_id=v_previous.id
      and cancelled.logical_occurrence_id=candidate.logical_occurrence_id)) then
    raise exception 'At least one approved occurrence must start in the future.' using errcode='RAR03'; end if;
  -- A replacement may contain past dates only when they match the already
  -- approved occurrence and its room/resource requests. Historical holds stay
  -- linked to the prior immutable commitment and are never recreated.
  if exists(select 1 from public.calendar_submission_occurrences candidate where candidate.submission_id=v_submission.id
    and candidate.occupancy_start<=now() and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc
      where cc.commitment_id=v_previous.id and cc.logical_occurrence_id=candidate.logical_occurrence_id)
    and (candidate.occupancy_end>now() or v_previous.id is null or not exists (
      select 1 from public.calendar_submission_occurrences prior where prior.submission_id=v_previous.submission_id
        and prior.logical_occurrence_id=candidate.logical_occurrence_id
        and prior.start_at=candidate.start_at and prior.end_at=candidate.end_at
        and prior.occupancy_start=candidate.occupancy_start and prior.occupancy_end=candidate.occupancy_end
        and not exists ((select room_id from public.calendar_submission_room_requests where submission_occurrence_id=prior.id
          except select room_id from public.calendar_submission_room_requests where submission_occurrence_id=candidate.id)
          union all (select room_id from public.calendar_submission_room_requests where submission_occurrence_id=candidate.id
          except select room_id from public.calendar_submission_room_requests where submission_occurrence_id=prior.id))
        and not exists ((select resource_id,quantity_requested from public.calendar_submission_resource_requests where submission_occurrence_id=prior.id
          except select resource_id,quantity_requested from public.calendar_submission_resource_requests where submission_occurrence_id=candidate.id)
          union all (select resource_id,quantity_requested from public.calendar_submission_resource_requests where submission_occurrence_id=candidate.id
          except select resource_id,quantity_requested from public.calendar_submission_resource_requests where submission_occurrence_id=prior.id))
    ))) then raise exception 'Past occurrences must retain their approved room and resource details.' using errcode='RAR03'; end if;

  -- Take requested room and resource locks in stable order before evaluating
  -- operational facts and decisions. Resource allocators use the same row locks.
  perform 1 from public.rooms r where r.id in (select rr.room_id from public.calendar_submission_room_requests rr
    join public.calendar_submission_occurrences o on o.id=rr.submission_occurrence_id where o.submission_id=v_submission.id and o.occupancy_start>now()
    union select old.room_id from public.reservations old where old.calendar_commitment_id=v_previous.id and old.status='approved' and old.start_at>now())
    order by r.id for update;
  perform 1 from public.calendar_resources r where r.id in (select rr.resource_id from public.calendar_submission_resource_requests rr
    join public.calendar_submission_occurrences o on o.id=rr.submission_occurrence_id where o.submission_id=v_submission.id and o.occupancy_start>now()
    union select old.resource_id from public.calendar_resource_allocations old join public.calendar_submission_occurrences oo on oo.id=old.submission_occurrence_id
      where oo.submission_id=v_previous.submission_id and old.status='confirmed' and old.occupancy_start>now())
    order by r.id for update;
  perform 1 from private.calendar_conflict_policy where id for share;

  -- Approved on-site exclusivity is property-wide, even for events without rooms.
  if exists(select 1 from public.calendar_submission_occurrences candidate
    join public.calendar_event_commitments committed on committed.state='active' and committed.event_id<>p_event_id
    join public.calendar_event_submissions other on other.id=committed.submission_id
    join public.calendar_submission_occurrences occupied on occupied.submission_id=other.id
    where candidate.submission_id=v_submission.id and candidate.occupancy_start>now() and v_submission.location_type='church' and other.location_type='church'
      and (v_submission.protection='exclusive' or other.protection='exclusive')
      and candidate.occupancy_range && occupied.occupancy_range
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=v_previous.id and cc.logical_occurrence_id=candidate.logical_occurrence_id)
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=committed.id and cc.submission_occurrence_id=occupied.id)) then
    raise exception 'An approved exclusive on-site event overlaps this request.' using errcode='RAR09';
  end if;

  for v_conflict in select c.* from private.calendar_current_conflicts() c
    where c.ends_at>now() and (c.event_id=p_event_id or c.other_event_id=p_event_id or
      (c.conflict_type='resource_planning' and exists (select 1 from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) p
        where p->>'event_id'=p_event_id::text))) loop
    if v_conflict.classification='hard' then raise exception 'Resolve current operational and policy blocks first.' using errcode='RAR09'; end if;
    select d.* into v_decision from public.calendar_conflict_decisions d where d.fingerprint=v_conflict.fingerprint
      and ((v_conflict.classification='planning' and d.decision_type='advance')
        or (v_conflict.classification='warning' and d.decision_type='acknowledge')) order by d.decision_order desc limit 1;
    if not found or (v_conflict.classification='planning' and v_decision.selected_event_id is distinct from p_event_id) then
      raise exception 'Current conflict decisions or warning acknowledgments are required.' using errcode='RAR09';
    end if;
  end loop;

  -- The checked fingerprints excluded only this event's old commitments. Retire
  -- those after checking, under the same locks, then create the replacement.
  if v_previous.id is not null then
    perform private.calendar_retire_commitment(p_event_id,v_previous.id,'Replaced by a newly approved revision','replaced');
  end if;
  insert into public.calendar_event_commitments(event_id,submission_id,approved_by)
    values(p_event_id,v_submission.id,v_actor) returning id into v_commitment;
  -- Cancellation of a logical date remains in force across an ordinary revision;
  -- an explicit future restoration workflow must be separately authorized.
  insert into public.calendar_commitment_occurrence_cancellations(commitment_id,submission_occurrence_id,logical_occurrence_id,reason,cancelled_by,cancelled_at,copied_from)
    select v_commitment,o.id,o.logical_occurrence_id,c.reason,c.cancelled_by,c.cancelled_at,c.id
    from public.calendar_commitment_occurrence_cancellations c join public.calendar_submission_occurrences o
      on o.submission_id=v_submission.id and o.logical_occurrence_id=c.logical_occurrence_id
    where c.commitment_id=v_previous.id;
  for v_item in select o.id as occurrence_id,o.occupancy_start,o.occupancy_end,rr.room_id
    from public.calendar_submission_occurrences o join public.calendar_submission_room_requests rr on rr.submission_occurrence_id=o.id
    where o.submission_id=v_submission.id and o.occupancy_start>now()
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=v_commitment and cc.submission_occurrence_id=o.id)
    order by o.id,rr.room_id loop
    -- Use the same church-local start date and room horizon as the reservation validator.
    v_bypass_used := v_bypass_used or
      (v_item.occupancy_start at time zone (select timezone from public.app_settings where id))::date
        > public.booking_horizon_date(v_item.room_id);
    v_reservation:=gen_random_uuid();
    insert into private.calendar_reservation_capabilities(transaction_id,reservation_id,submission_occurrence_id,operation)
      values(txid_current(),v_reservation,v_item.occurrence_id,'create');
    v_attempt:=0;
    loop
      v_attempt:=v_attempt+1; v_reference:=private.generate_reference_code();
      begin
        insert into public.reservations(id,reference_code,status,source,room_id,start_at,end_at,
          requester_first_name,requester_last_name,requester_email,requester_phone,ministry_id,purpose,estimated_attendance,
          approval_required_at_submission,food_drinks_allowed_at_submission,room_capacity_at_submission,
          created_by_user_id,approved_by,guest_token_hash,guest_token_seed,calendar_submission_occurrence_id,calendar_commitment_id)
        values(v_reservation,v_reference,'approved','admin',v_item.room_id,v_item.occupancy_start,v_item.occupancy_end,
          btrim(p_first_name),btrim(p_last_name),lower(btrim(v_grant.contact_email)),p_phone,v_plan.ministry_id,v_submission.title,v_submission.estimated_attendance,
          false,false,0,v_actor,v_actor,sha256(uuid_send(gen_random_uuid())),uuid_send(gen_random_uuid()),v_item.occurrence_id,v_commitment);
        exit;
      exception when unique_violation then if v_attempt>=5 then raise; end if; end;
    end loop;
    delete from private.calendar_reservation_capabilities where transaction_id=txid_current() and reservation_id=v_reservation and operation='create';
  end loop;
  for v_item in select o.id as occurrence_id,rr.resource_id from public.calendar_submission_occurrences o
    join public.calendar_submission_resource_requests rr on rr.submission_occurrence_id=o.id
    where o.submission_id=v_submission.id and o.occupancy_start>now()
      and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=v_commitment and cc.submission_occurrence_id=o.id)
    order by o.id,rr.resource_id loop
    perform private.calendar_allocate_resource(v_item.occurrence_id,v_item.resource_id);
  end loop;
  perform private.calendar_audit(v_actor,'calendar_event.approved','calendar_event',p_event_id,
    jsonb_build_object('commitment_id',v_commitment,'submission_id',v_submission.id,'revision',p_expected_revision,
      'bypass_advance_horizon_used',v_bypass_used));
  perform private.queue_calendar_event_notice(v_commitment,
    case when v_previous.id is null then 'approved' else 'replaced' end,v_actor,null);
  return v_commitment;
end;
$$;
