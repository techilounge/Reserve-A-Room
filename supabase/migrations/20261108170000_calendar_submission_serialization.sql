-- A new submitted proposal must not appear between an approval's conflict
-- check and its commit, including when it belongs to a newly created cycle.
-- Acquire the same fence before the existing submission function locks a cycle.
alter function public.calendar_submit_plan(uuid,text,text,boolean) set schema private;
revoke execute on function private.calendar_submit_plan(uuid,text,text,boolean)
  from public,anon,authenticated,service_role;

create function public.calendar_submit_plan(p_plan_id uuid,p_session_hash text,p_message text,p_confirm_empty boolean)
returns integer language plpgsql security definer set search_path = '' as $$
begin
  -- Reject callers before acquiring a global lock. The original function still
  -- checks the planner's session, policy acceptance and cycle under row locks.
  if not private.is_calendar_service() then
    raise exception 'Planning access unavailable.' using errcode='RAR09';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reserve_a_room.calendar_approval',0));
  update private.calendar_commitment_serialization set revision=revision+1 where id;
  return private.calendar_submit_plan(p_plan_id,p_session_hash,p_message,p_confirm_empty);
end;
$$;
revoke execute on function public.calendar_submit_plan(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.calendar_submit_plan(uuid,text,text,boolean) to service_role;
