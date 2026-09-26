-- Audit Log filtering is applied before pagination so every page is searched consistently.

drop function if exists public.admin_audit_log(text, text, integer, integer);

create function public.admin_audit_log(
  p_search text default null,
  p_entity_type text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id bigint, created_at timestamptz, actor_kind public.actor_kind, actor_name text, action text,
  entity_type text, entity_id text, metadata jsonb, total_count bigint
)
language plpgsql
stable
set search_path = ''
as $$
declare
  -- Match the human-readable UI title as well as raw database values. For
  -- example, "Amenity created · Chairs" spans action and metadata fields.
  v_search text := nullif(btrim(regexp_replace(lower(p_search), '[^[:alnum:]]+', ' ', 'g')), '');
begin
  perform private.require_super_admin();
  if p_from is not null and p_to is not null and p_from >= p_to then
    raise exception using errcode = '22023', message = 'The audit date range is invalid.';
  end if;

  return query
  select a.id, a.created_at, a.actor_kind, p.full_name, a.action, a.entity_type, a.entity_id, a.metadata,
         count(*) over ()
  from public.audit_logs a
  left join public.profiles p on p.id = a.actor_user_id
  where (p_entity_type is null or a.entity_type = p_entity_type)
    and (p_from is null or a.created_at >= p_from)
    and (p_to is null or a.created_at < p_to)
    and (
      v_search is null
      or not exists (
        select 1
        from regexp_split_to_table(v_search, '[[:space:]]+') as search_term
        where search_term <> ''
          and regexp_replace(
            lower(concat_ws(
              ' ',
              case a.action
                when 'reservation.created' then 'Reservation created'
                when 'reservation.approved' then 'Reservation approved'
                when 'reservation.declined' then 'Reservation declined'
                when 'reservation.cancelled' then 'Reservation cancelled'
                when 'reservation.updated' then 'Reservation edited'
                when 'reservation.notes_updated' then 'Private notes updated'
                when 'recurring_request.created' then 'Recurring request submitted'
                when 'room.created' then 'Room created'
                when 'room.updated' then 'Room updated'
                when 'room.deleted' then 'Room deleted'
                when 'room_amenity.created' then 'Amenity added to room'
                when 'room_amenity.deleted' then 'Amenity removed from room'
                when 'amenity.created' then 'Amenity created'
                when 'amenity.updated' then 'Amenity updated'
                when 'ministry.created' then 'Ministry added'
                when 'ministry.updated' then 'Ministry updated'
                when 'settings.updated' then 'Settings changed'
                when 'user.created' then 'Administrator added'
                when 'user.updated' then 'Administrator changed'
                when 'user.deleted' then 'Administrator removed'
                when 'user.bootstrapped' then 'First Super Admin created'
                when 'user.invitation_accepted' then 'Administrator invitation accepted'
                when 'user.logged_in' then 'Administrator signed in'
                else a.action
              end,
              a.action,
              a.entity_type,
              p.full_name,
              a.entity_id,
              a.metadata::text
            )),
            '[^[:alnum:]]+',
            ' ',
            'g'
          ) not like '%' || search_term || '%'
      )
    )
  order by a.created_at desc, a.id desc
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
end;
$$;

revoke execute on function public.admin_audit_log(text, text, timestamptz, timestamptz, integer, integer) from public, anon;
grant execute on function public.admin_audit_log(text, text, timestamptz, timestamptz, integer, integer) to authenticated, service_role;
