-- Run this entire file after posts-schema.sql in the Supabase SQL Editor.
begin;
create table if not exists public.member_blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists member_blocks_blocked_idx on public.member_blocks (blocked_id);
alter table public.member_blocks enable row level security;
drop policy if exists "Manage own blocks" on public.member_blocks;
create policy "Manage own blocks" on public.member_blocks for all to authenticated
  using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

create or replace function public.members_blocked(first_id uuid, second_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.member_blocks
    where (blocker_id = first_id and blocked_id = second_id)
       or (blocker_id = second_id and blocked_id = first_id));
$$;
revoke all on function public.members_blocked(uuid, uuid) from public;
grant execute on function public.members_blocked(uuid, uuid) to authenticated;
grant execute on function public.members_blocked(uuid, uuid) to service_role;

-- Restrictive policies also apply alongside existing permissive read policies.
drop policy if exists "Respect profile blocks" on public.profiles;
create policy "Respect profile blocks" on public.profiles as restrictive for select to authenticated
  using (not public.members_blocked(auth.uid(), user_id));
drop policy if exists "Respect post blocks" on public.posts;
create policy "Respect post blocks" on public.posts as restrictive for select to authenticated
  using (not public.members_blocked(auth.uid(), user_id));
drop policy if exists "Respect follow blocks" on public.follows;
create policy "Respect follow blocks" on public.follows as restrictive for insert to authenticated
  with check (not public.members_blocked(follower_id, following_id));
drop policy if exists "Respect like blocks" on public.post_likes;
create policy "Respect like blocks" on public.post_likes as restrictive for insert to authenticated
  with check (exists (select 1 from public.posts where id = post_id));
drop policy if exists "Respect comment blocks" on public.post_comments;
create policy "Respect comment blocks" on public.post_comments as restrictive for insert to authenticated
  with check (exists (select 1 from public.posts where id = post_id));

revoke update on public.posts from authenticated;
grant update (caption) on public.posts to authenticated;
drop policy if exists "Edit own posts" on public.posts;
create policy "Edit own posts" on public.posts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.post_comments from authenticated;
grant update (content) on public.post_comments to authenticated;
drop policy if exists "Edit own comments" on public.post_comments;
create policy "Edit own comments" on public.post_comments for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "Respect comment visibility" on public.post_comments;
create policy "Respect comment visibility" on public.post_comments as restrictive for select to authenticated
  using (not public.members_blocked(auth.uid(), user_id)
    and exists (select 1 from public.posts where id = post_id));
drop policy if exists "Respect like visibility" on public.post_likes;
create policy "Respect like visibility" on public.post_likes as restrictive for select to authenticated
  using (not public.members_blocked(auth.uid(), user_id)
    and exists (select 1 from public.posts where id = post_id));
drop policy if exists "Respect notification blocks" on public.notifications;
create policy "Respect notification blocks" on public.notifications as restrictive for select to authenticated
  using (actor_id is null or not public.members_blocked(auth.uid(), actor_id));
drop policy if exists "Respect image blocks" on storage.objects;
create policy "Respect image blocks" on storage.objects as restrictive for select to authenticated
  using (bucket_id <> 'photo' or case
    when (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then not public.members_blocked(auth.uid(), ((storage.foldername(name))[1])::uuid)
    else false end);

create table if not exists public.member_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete set null,
  member_id uuid references auth.users(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 3 and 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create index if not exists member_reports_status_idx on public.member_reports (status, created_at desc);
alter table public.member_reports enable row level security;
grant all on public.member_reports to service_role;
-- Report reads and writes are authorized by the server API.

-- Preserve legacy shared numbers while reserving each number once for new writes.
create or replace function public.normalize_member_phone(value text)
returns text language sql immutable set search_path = public as $$
  select case
    when length(digits) = 10 then '91' || digits
    else digits end
  from (select regexp_replace(coalesce(value, ''), '[^0-9]', '', 'g') as digits) cleaned;
$$;

create table if not exists public.member_phone_numbers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null
);
alter table public.member_phone_numbers drop constraint if exists member_phone_numbers_phone_key;
create index if not exists member_phone_numbers_phone_idx on public.member_phone_numbers(phone);
alter table public.member_phone_numbers enable row level security;
grant all on public.member_phone_numbers to service_role;
create table if not exists public.member_phone_reservations (
  phone text primary key
);
alter table public.member_phone_reservations enable row level security;
grant all on public.member_phone_reservations to service_role;
insert into public.member_phone_reservations(phone)
select distinct public.normalize_member_phone(raw_user_meta_data->>'phone')
from auth.users where public.normalize_member_phone(raw_user_meta_data->>'phone') <> ''
on conflict (phone) do nothing;
insert into public.member_phone_numbers(user_id, phone)
select id, public.normalize_member_phone(raw_user_meta_data->>'phone')
from auth.users where public.normalize_member_phone(raw_user_meta_data->>'phone') <> ''
on conflict (user_id) do update set phone = excluded.phone;

create or replace function public.sync_member_phone()
returns trigger language plpgsql security definer set search_path = public as $$
declare normalized text; previous_phone text;
begin
  normalized := public.normalize_member_phone(new.raw_user_meta_data->>'phone');
  if tg_op = 'UPDATE' then
    previous_phone := public.normalize_member_phone(old.raw_user_meta_data->>'phone');
    if normalized = previous_phone then return new; end if;
  end if;
  if normalized = '' then
    delete from public.member_phone_numbers where user_id = new.id;
  else
    insert into public.member_phone_reservations(phone) values (normalized)
      on conflict (phone) do nothing;
    if not found then
      raise exception 'This phone number is already linked to another account.'
        using errcode = '23505', constraint = 'member_phone_reservations_pkey';
    end if;
    insert into public.member_phone_numbers(user_id, phone) values (new.id, normalized)
    on conflict (user_id) do update set phone = excluded.phone;
  end if;
  return new;
end;
$$;
drop trigger if exists sync_member_phone on auth.users;
create trigger sync_member_phone after insert or update of raw_user_meta_data on auth.users
  for each row execute function public.sync_member_phone();

create or replace function public.release_member_phone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.member_phone_reservations r where r.phone = old.phone
    and not exists (select 1 from public.member_phone_numbers n where n.phone = old.phone);
  return old;
end;
$$;
drop trigger if exists release_member_phone on public.member_phone_numbers;
create trigger release_member_phone after delete or update of phone on public.member_phone_numbers
  for each row execute function public.release_member_phone();

alter table public.posts add column if not exists thumbnail_path text not null default '';
create index if not exists posts_created_id_idx on public.posts(created_at desc, id desc);
create index if not exists posts_user_created_id_idx on public.posts(user_id, created_at desc, id desc);
create index if not exists comments_post_created_id_idx on public.post_comments(post_id, created_at desc, id desc);
create index if not exists follows_follower_created_id_idx on public.follows(follower_id, created_at desc, following_id desc);
create index if not exists follows_following_created_id_idx on public.follows(following_id, created_at desc, follower_id desc);
create extension if not exists pg_trgm with schema extensions;
create index if not exists profiles_name_search_idx on public.profiles using gin (full_name extensions.gin_trgm_ops);

-- One server-only call supplies authors, verification, counts and two comments.
create or replace function public.feed_post_details(post_ids uuid[], viewer_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
select coalesce(jsonb_agg(jsonb_build_object(
  'id', p.id,
  'author', jsonb_build_object('user_id', u.id, 'full_name', coalesce(pr.full_name, ''),
    'location', coalesce(pr.location, ''), 'avatar_path', coalesce(pr.avatar_path, ''),
    'is_verified', coalesce((u.raw_app_meta_data->>'is_verified')::boolean, false)),
  'like_count', (select count(*) from public.post_likes l where l.post_id = p.id
    and not public.members_blocked(viewer_id, l.user_id)),
  'liked_by_me', exists(select 1 from public.post_likes l where l.post_id = p.id and l.user_id = viewer_id),
  'comments_total', (select count(*) from public.post_comments c where c.post_id = p.id
    and not public.members_blocked(viewer_id, c.user_id)),
  'comments', (select coalesce(jsonb_agg(row_to_json(recent) order by recent.created_at desc, recent.id desc), '[]'::jsonb) from (
    select c.id, c.post_id, c.user_id, c.content, c.created_at, coalesce(cp.full_name, 'Member') as author_name
    from public.post_comments c left join public.profiles cp on cp.user_id = c.user_id
    where c.post_id = p.id and not public.members_blocked(viewer_id, c.user_id)
    order by c.created_at desc, c.id desc limit 2
  ) recent)
)), '[]'::jsonb)
from public.posts p join auth.users u on u.id = p.user_id
left join public.profiles pr on pr.user_id = p.user_id
where p.id = any(post_ids) and not public.members_blocked(viewer_id, p.user_id);
$$;
revoke all on function public.feed_post_details(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.feed_post_details(uuid[], uuid) to service_role;

commit;
