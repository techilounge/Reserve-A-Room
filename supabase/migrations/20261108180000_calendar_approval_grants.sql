-- The transaction itself rechecks active staff authorization, current submitted
-- revisions, conflicts and all resource/room rules. No direct table writes are granted.
grant execute on function public.calendar_approve_event(uuid,integer,text,text,text,uuid),
  public.calendar_cancel_event(uuid,uuid,text),
  public.calendar_cancel_event_occurrence(uuid,uuid,uuid,text) to authenticated;
