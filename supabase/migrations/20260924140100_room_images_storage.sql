-- Reserve-A-Room · Room photos in Supabase Storage.
-- Public read (room photos are public), writes limited to Super Admins, images only.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('room-images', 'room-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy room_images_insert_super_admin on storage.objects for insert to authenticated
  with check (bucket_id = 'room-images' and (select private.is_super_admin()));

create policy room_images_update_super_admin on storage.objects for update to authenticated
  using (bucket_id = 'room-images' and (select private.is_super_admin()))
  with check (bucket_id = 'room-images' and (select private.is_super_admin()));

create policy room_images_delete_super_admin on storage.objects for delete to authenticated
  using (bucket_id = 'room-images' and (select private.is_super_admin()));
