-- Reserve-A-Room · Initial reference data (real production data, idempotent).
--
-- Per the owner: one room (Conference Room) and the ministries named in the brief.
-- Super Admins add, edit and archive rooms/ministries/amenities from the admin UI.

insert into public.app_settings (id) values (true)
on conflict (id) do nothing;

insert into public.amenities (name, icon, sort_order) values
  ('Projector', 'projector', 10),
  ('TV / Display', 'monitor', 20),
  ('Sound System', 'speaker', 30),
  ('Whiteboard', 'presentation', 40),
  ('Tables', 'table', 50),
  ('Chairs', 'armchair', 60),
  ('Kitchen Access', 'cooking-pot', 70),
  ('Piano', 'piano', 80),
  ('Wi-Fi', 'wifi', 90)
on conflict ((lower(name))) do nothing;

insert into public.ministries (name, sort_order) values
  ('Bread of Life Ministry', 10),
  ('Austin Knights Pathfinder Club', 20),
  ('Stonehill Squires Adventurers Club', 30),
  ('Prayer Ministry', 40),
  ('Women''s Ministry', 50),
  ('Men''s Ministry', 60),
  ('Music Ministry', 70),
  ('Prison Ministry', 80),
  ('Family Life Ministry', 90),
  ('Health & Wellness Ministry', 100),
  ('Stewardship / Finance Ministry', 110)
on conflict ((lower(name))) do nothing;

-- Conference Room — settings from the master brief: capacity 15, confirmed instantly,
-- reservable up to 4 weeks ahead, no food or drinks.
insert into public.rooms (
  name, slug, description, capacity, approval_required,
  max_advance_value, max_advance_unit, food_drinks_allowed, sort_order
) values (
  'Conference Room',
  'conference-room',
  'A meeting room for planning sessions, committee meetings and small-group gatherings.',
  15, false, 4, 'week', false, 10
)
on conflict (slug) do nothing;
