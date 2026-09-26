-- Ordered room-image galleries. Existing single photos become the primary image.

alter table public.rooms add column image_paths text[] not null default '{}';

update public.rooms
set image_paths = array[image_path]
where image_path is not null;

create function private.valid_room_image_paths(p_room_id uuid, p_paths text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(cardinality(p_paths), 0) <= 4
    and not exists (
      select 1
      from unnest(coalesce(p_paths, '{}')) as path
      where path is null
         or path !~ ('^rooms/' || p_room_id::text || '/[A-Za-z0-9._-]+$')
    )
    and cardinality(coalesce(p_paths, '{}')) = (
      select count(distinct path)::integer from unnest(coalesce(p_paths, '{}')) as path
    );
$$;

revoke execute on function private.valid_room_image_paths(uuid, text[]) from public, anon;
grant execute on function private.valid_room_image_paths(uuid, text[]) to authenticated, service_role;

alter table public.rooms
  add constraint rooms_image_paths_valid
  check (private.valid_room_image_paths(id, image_paths));

update storage.buckets
set file_size_limit = 2097152,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id = 'room-images';

create function public.admin_room_image_paths(p_room_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_paths text[];
begin
  perform private.require_staff();
  select r.image_paths into v_paths from public.rooms r where r.id = p_room_id;
  if not found then raise exception 'Room not found.' using errcode = 'RAR08'; end if;
  return v_paths;
end;
$$;

create function public.set_room_images(p_id uuid, p_image_paths text[] default '{}')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paths text[] := coalesce(p_image_paths, '{}');
begin
  perform private.require_super_admin();
  if not private.valid_room_image_paths(p_id, v_paths) then
    raise exception 'Use no more than four unique room image paths.' using errcode = 'RAR10';
  end if;

  update public.rooms
  set image_paths = v_paths,
      image_path = v_paths[1]
  where id = p_id;
  if not found then
    raise exception 'Room not found.' using errcode = 'RAR08';
  end if;
end;
$$;

-- Retain the original RPC as a compatible single-image wrapper.
create or replace function public.set_room_image(p_id uuid, p_image_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.set_room_images(p_id, case when p_image_path is null then '{}' else array[p_image_path] end);
end;
$$;

revoke execute on function public.set_room_images(uuid, text[]) from public, anon;
grant execute on function public.set_room_images(uuid, text[]) to authenticated, service_role;
revoke execute on function public.admin_room_image_paths(uuid) from public, anon;
grant execute on function public.admin_room_image_paths(uuid) to authenticated, service_role;
