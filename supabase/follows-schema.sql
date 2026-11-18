-- Run this in the Supabase SQL Editor to enable member follows.
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
