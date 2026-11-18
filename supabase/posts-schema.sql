-- Run in Supabase SQL Editor to enable member profiles and photo posts.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  education text not null default '',
  description text not null default '',
  location text not null default '',
  latitude double precision,
  longitude double precision,
  church_name text not null default '',
  church_location text not null default '',
  instagram_url text not null default '',
  facebook_url text not null default '',
  youtube_url text not null default '',
  avatar_path text not null default '',
  updated_at timestamptz not null default now(),
  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180)
);

alter table public.profiles
  add column if not exists church_location text not null default '';

alter table public.profiles enable row level security;

-- Copy existing profile metadata so existing members immediately appear in the feed.
insert into public.profiles (
  user_id, full_name, education, description, location, latitude, longitude,
  church_name, church_location, instagram_url, facebook_url, youtube_url, avatar_path
)
select
  id,
  coalesce(raw_user_meta_data->>'full_name', ''),
  coalesce(raw_user_meta_data->>'education', ''),
  coalesce(raw_user_meta_data->>'description', ''),
  coalesce(raw_user_meta_data->>'location', ''),
  case when raw_user_meta_data->>'latitude' ~ '^-?[0-9]+(\.[0-9]+)?$' then (raw_user_meta_data->>'latitude')::double precision end,
  case when raw_user_meta_data->>'longitude' ~ '^-?[0-9]+(\.[0-9]+)?$' then (raw_user_meta_data->>'longitude')::double precision end,
  coalesce(raw_user_meta_data->>'church_name', ''),
  coalesce(raw_user_meta_data->>'church_location', ''),
  coalesce(raw_user_meta_data->>'instagram_url', ''),
  coalesce(raw_user_meta_data->>'facebook_url', ''),
  coalesce(raw_user_meta_data->>'youtube_url', ''),
  coalesce(raw_user_meta_data->>'avatar_path', '')
from auth.users
on conflict (user_id) do update set
  full_name = excluded.full_name,
  education = excluded.education,
  description = excluded.description,
  location = excluded.location,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  church_name = excluded.church_name,
  church_location = excluded.church_location,
  instagram_url = excluded.instagram_url,
  facebook_url = excluded.facebook_url,
  youtube_url = excluded.youtube_url,
  avatar_path = excluded.avatar_path,
  updated_at = now();

drop policy if exists "Members can view public profiles" on public.profiles;
create policy "Members can view public profiles"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "Members can create their own profile" on public.profiles;
create policy "Members can create their own profile"
  on public.profiles for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Members can update their own profile" on public.profiles;
create policy "Members can update their own profile"
  on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  caption text not null default '',
  location text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  created_at timestamptz not null default now(),
  constraint posts_image_path_unique unique (image_path)
);

create index if not exists posts_user_created_at_idx
  on public.posts (user_id, created_at desc);

-- Members can follow other profiles. Feed reads and writes go through the
-- authenticated server API; row level security still scopes member writes.
create table if not exists public.follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create index if not exists follows_following_id_idx on public.follows (following_id, follower_id);
alter table public.follows enable row level security;

drop policy if exists "Members can view their follows" on public.follows;
create policy "Members can view their follows"
  on public.follows for select to authenticated
  using (follower_id = (select auth.uid()));
drop policy if exists "Members can follow as themselves" on public.follows;
create policy "Members can follow as themselves"
  on public.follows for insert to authenticated
  with check (follower_id = (select auth.uid()) and follower_id <> following_id);
drop policy if exists "Members can unfollow as themselves" on public.follows;
create policy "Members can unfollow as themselves"
  on public.follows for delete to authenticated
  using (follower_id = (select auth.uid()));

alter table public.posts enable row level security;

drop policy if exists "Members can view their own posts" on public.posts;
drop policy if exists "Members can view member posts" on public.posts;
create policy "Members can view member posts"
  on public.posts for select to authenticated
  using (true);

drop policy if exists "Members can create their own posts with a location" on public.posts;
create policy "Members can create their own posts with a location"
  on public.posts for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and image_path like (select auth.uid())::text || '/posts/%'
    and length(trim(location)) > 0
  );

drop policy if exists "Members can delete their own posts" on public.posts;
create policy "Members can delete their own posts"
  on public.posts for delete to authenticated
  using (user_id = (select auth.uid()));

-- Likes and comments are shared with authenticated members in the feed.
create table if not exists public.post_likes (
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists post_likes_post_id_idx on public.post_likes (post_id);
alter table public.post_likes enable row level security;

drop policy if exists "Members can view post likes" on public.post_likes;
create policy "Members can view post likes"
  on public.post_likes for select to authenticated using (true);
drop policy if exists "Members can like posts as themselves" on public.post_likes;
create policy "Members can like posts as themselves"
  on public.post_likes for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Members can remove their own likes" on public.post_likes;
create policy "Members can remove their own likes"
  on public.post_likes for delete to authenticated
  using (user_id = (select auth.uid()));

create table if not exists public.post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists post_comments_post_created_at_idx
  on public.post_comments (post_id, created_at asc);
alter table public.post_comments enable row level security;

drop policy if exists "Members can view post comments" on public.post_comments;
create policy "Members can view post comments"
  on public.post_comments for select to authenticated using (true);
drop policy if exists "Members can comment as themselves" on public.post_comments;
create policy "Members can comment as themselves"
  on public.post_comments for insert to authenticated
  with check (user_id = (select auth.uid()));
drop policy if exists "Members can delete their own comments" on public.post_comments;
create policy "Members can delete their own comments"
  on public.post_comments for delete to authenticated
  using (user_id = (select auth.uid()));

-- Allow cleanup of an uploaded photo if saving the post row fails.
drop policy if exists "Users can delete their own profile images" on storage.objects;
create policy "Users can delete their own profile images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'photo'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Members can view shared profile and post images" on storage.objects;
create policy "Members can view shared profile and post images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'photo'
    and (
      (storage.foldername(name))[2] = 'posts'
      or name ~* '^[0-9a-f-]{36}/profile\.[a-z0-9]+$'
    )
  );
