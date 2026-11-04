-- Private occurrence cancellation. The public interface remains ungranted
-- while Phase 6 is under development and has not passed real race tests.
create function private.calendar_cancel_occurrence(p_event_id uuid,p_commitment uuid,p_occurrence uuid,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid:=private.require_staff(); v_commitment public.calendar_event_commitments;
  v_occurrence public.calendar_submission_occurrences; v_item record; v_id uuid;
begin
  if char_length(btrim(coalesce(p_reason,''))) not between 3 and 2000 then
    raise exception 'A cancellation reason is required.' using errcode='RAR09'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reserve_a_room.calendar_approval',0));
  update private.calendar_commitment_serialization set revision=revision+1 where id;
  perform 1 from public.calendar_cycles order by id for update;
  perform 1 from public.ministry_calendar_plans order by id for update;
  perform 1 from public.calendar_events order by id for update;
  select * into v_commitment from public.calendar_event_commitments
    where id=p_commitment and event_id=p_event_id and state='active' for update;
  if not found then raise exception 'The approval changed; refresh and try again.' using errcode='RAR09'; end if;
  select * into v_occurrence from public.calendar_submission_occurrences
    where id=p_occurrence and submission_id=v_commitment.submission_id;
  if not found or v_occurrence.occupancy_start<=now() or exists(select 1 from public.calendar_commitment_occurrence_cancellations
    where commitment_id=v_commitment.id and submission_occurrence_id=p_occurrence) then
    raise exception 'Only a future, uncancelled occurrence can be cancelled.' using errcode='RAR09'; end if;
  perform 1 from public.rooms r where r.id in (select room_id from public.reservations
    where calendar_commitment_id=v_commitment.id and calendar_submission_occurrence_id=p_occurrence and status='approved') order by r.id for update;
  perform 1 from public.calendar_resources r where r.id in (select resource_id from public.calendar_resource_allocations
    where submission_occurrence_id=p_occurrence and status='confirmed') order by r.id for update;
  for v_item in select id from public.reservations where calendar_commitment_id=v_commitment.id
    and calendar_submission_occurrence_id=p_occurrence and status='approved' order by id for update loop
    insert into private.calendar_reservation_capabilities(transaction_id,reservation_id,submission_occurrence_id,operation)
      values(txid_current(),v_item.id,p_occurrence,'cancel');
    update public.reservations set status='cancelled',cancelled_by_user_id=v_actor where id=v_item.id;
    delete from private.calendar_reservation_capabilities where transaction_id=txid_current() and reservation_id=v_item.id and operation='cancel';
  end loop;
  for v_item in select id from public.calendar_resource_allocations where submission_occurrence_id=p_occurrence and status='confirmed'
    order by resource_id,id loop perform private.calendar_release_resource(v_item.id); end loop;
  insert into public.calendar_commitment_occurrence_cancellations(commitment_id,submission_occurrence_id,logical_occurrence_id,reason,cancelled_by)
    values(v_commitment.id,p_occurrence,v_occurrence.logical_occurrence_id,btrim(p_reason),v_actor) returning id into v_id;
  perform private.calendar_audit(v_actor,'calendar_occurrence.cancelled','calendar_occurrence',v_id,
    jsonb_build_object('event_id',p_event_id,'commitment_id',v_commitment.id,'submission_occurrence_id',p_occurrence,'reason',btrim(p_reason)));
  perform private.queue_calendar_event_notice(v_commitment.id,'occurrence_cancelled',v_actor,btrim(p_reason),p_occurrence);
end;
$$;
revoke execute on function private.calendar_cancel_occurrence(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create function public.calendar_cancel_event_occurrence(p_event_id uuid,p_expected_commitment uuid,p_occurrence uuid,p_reason text)
returns void language sql security definer set search_path = '' as $$
  select private.calendar_cancel_occurrence(p_event_id,p_expected_commitment,p_occurrence,p_reason);
$$;
revoke execute on function public.calendar_cancel_event_occurrence(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;

create or replace function public.calendar_staff_occurrences(p_submission_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  if not exists (select 1 from public.calendar_event_submissions where id=p_submission_id) then
    raise exception 'Calendar submission unavailable.' using errcode='RAR09'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'logical_id',o.logical_occurrence_id,
    'event_id',s.event_id,'commitment_id',cm.id,
    'cancelled',exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=cm.id and cc.submission_occurrence_id=o.id),
    'can_cancel',cm.id is not null and o.occupancy_start>now() and not exists(select 1 from public.calendar_commitment_occurrence_cancellations cc where cc.commitment_id=cm.id and cc.submission_occurrence_id=o.id),
    'local_start',o.local_start,'local_end',o.local_end,'timezone',o.timezone,'all_day',o.all_day,
    'start_at',o.start_at,'end_at',o.end_at,'occupancy_start',o.occupancy_start,'occupancy_end',o.occupancy_end,
    'rooms',(select coalesce(jsonb_agg(jsonb_build_object('name',rm.name,'origin',r.origin) order by rm.name),'[]'::jsonb)
      from public.calendar_submission_room_requests r join public.rooms rm on rm.id=r.room_id where r.submission_occurrence_id=o.id),
    'resources',(select coalesce(jsonb_agg(jsonb_build_object('name',rs.name,'origin',r.origin,'quantity',r.quantity_requested,'notes',r.notes) order by rs.name),'[]'::jsonb)
      from public.calendar_submission_resource_requests r join public.calendar_resources rs on rs.id=r.resource_id where r.submission_occurrence_id=o.id)
  ) order by o.local_start,o.id),'[]'::jsonb) from public.calendar_submission_occurrences o
    join public.calendar_event_submissions s on s.id=o.submission_id
    left join public.calendar_event_commitments cm on cm.submission_id=s.id and cm.state='active'
    where o.submission_id=p_submission_id);
end;
$$;

create function public.calendar_reservation_link(p_reservation uuid)
returns table(commitment_id uuid,submission_id uuid,event_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require_staff();
  return query select c.id,c.submission_id,c.event_id from public.reservations r
    join public.calendar_event_commitments c on c.id=r.calendar_commitment_id
    where r.id=p_reservation;
end;
$$;
revoke execute on function public.calendar_reservation_link(uuid) from public,anon,service_role;
grant execute on function public.calendar_reservation_link(uuid) to authenticated;
