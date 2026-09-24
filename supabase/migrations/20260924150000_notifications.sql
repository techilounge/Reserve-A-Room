-- Reserve-A-Room · In-app notifications for staff.
-- All functions run as the caller (SECURITY INVOKER): RLS limits everyone to their own
-- notifications, and disabled staff see none.

create function public.my_notifications(p_unread_only boolean default false, p_limit integer default 20, p_offset integer default 0)
returns table (
  id uuid, type text, title text, message text, reservation_id uuid, read_at timestamptz,
  created_at timestamptz, total_count bigint
)
language sql
stable
set search_path = ''
as $$
  select n.id, n.type, n.title, n.message, n.reservation_id, n.read_at, n.created_at, count(*) over ()
  from public.notifications n
  where n.user_id = (select auth.uid()) and (not p_unread_only or n.read_at is null)
  order by n.created_at desc, n.id
  limit least(greatest(p_limit, 1), 100)
  offset greatest(p_offset, 0);
$$;

create function public.unread_notification_count()
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.notifications n
  where n.user_id = (select auth.uid()) and n.read_at is null;
$$;

create function public.mark_notifications_read(p_ids uuid[] default null)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.notifications n set read_at = now()
  where n.user_id = (select auth.uid()) and n.read_at is null
    and (p_ids is null or n.id = any (p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Notify other active staff (not the person who made the change).
create function private.notify_other_staff(p_actor uuid, p_type text, p_title text, p_message text, p_reservation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, type, title, message, reservation_id)
  select id, p_type, p_title, p_message, p_reservation_id
  from public.profiles where active and id is distinct from p_actor;
$$;
revoke execute on function private.notify_other_staff(uuid, text, text, text, uuid) from public, anon, authenticated;

-- "Reservation modified": when staff move an approved reservation, the rest of the team
-- hears about it. Implemented as a trigger so every path (edit form, future tools) is covered.
create function private.notify_reservation_moved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room text;
begin
  if new.status <> 'approved'
     or (new.room_id = old.room_id and new.start_at = old.start_at and new.end_at = old.end_at) then
    return null;
  end if;
  select name into v_room from public.rooms where id = new.room_id;
  perform private.notify_other_staff(
    (select auth.uid()),
    'reservation_modified',
    'Changed: ' || v_room,
    new.reference_code || ' for ' || new.requester_first_name || ' ' || new.requester_last_name || ' was rescheduled.',
    new.id
  );
  return null;
end;
$$;

create trigger reservations_30_notify_moved
  after update of room_id, start_at, end_at on public.reservations
  for each row execute function private.notify_reservation_moved();

grant execute on function public.my_notifications(boolean, integer, integer) to authenticated;
grant execute on function public.unread_notification_count() to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
