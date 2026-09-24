-- Reserve-A-Room · Public availability.
--
-- Guests have no access to the reservations table. This function exposes ONLY which
-- times are occupied (room, start, end) for active rooms — never who reserved it, why,
-- or its status — so the public calendar can show "Unavailable" without leaking data.

create function public.get_public_busy_blocks(
  p_from timestamptz,
  p_to timestamptz,
  p_room_ids uuid[] default null
)
returns table (room_id uuid, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.room_id, r.start_at, r.end_at
  from public.reservations r
  join public.rooms rm on rm.id = r.room_id and rm.active
  where r.status in ('pending', 'approved')
    and p_to > p_from
    and p_to - p_from <= interval '62 days'
    and r.reservation_range && tstzrange(p_from, p_to, '[)')
    and (p_room_ids is null or r.room_id = any (p_room_ids))
  order by r.room_id, r.start_at;
$$;

revoke execute on function public.get_public_busy_blocks(timestamptz, timestamptz, uuid[]) from public;
grant execute on function public.get_public_busy_blocks(timestamptz, timestamptz, uuid[]) to anon, authenticated, service_role;
