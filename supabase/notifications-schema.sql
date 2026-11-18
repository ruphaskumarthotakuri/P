-- Run after posts-schema.sql and follows-schema.sql in the Supabase SQL Editor.
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('new_member', 'follow', 'like', 'comment')),
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
alter table public.notifications enable row level security;

drop policy if exists "Members can read their notifications" on public.notifications;
create policy "Members can read their notifications"
  on public.notifications for select to authenticated
  using (recipient_id = (select auth.uid()));
drop policy if exists "Members can mark their notifications read" on public.notifications;
create policy "Members can mark their notifications read"
  on public.notifications for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

create or replace function public.notify_new_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, kind)
  select user_id, new.user_id, 'new_member'
  from public.profiles
  where user_id <> new.user_id;
  return new;
end;
$$;

create or replace function public.notify_new_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, kind)
  values (new.following_id, new.follower_id, 'follow');
  return new;
end;
$$;

create or replace function public.notify_new_post_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare post_owner uuid;
begin
  select user_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, kind, post_id)
    values (post_owner, new.user_id, 'like', new.post_id);
  end if;
  return new;
end;
$$;

create or replace function public.notify_new_post_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare post_owner uuid;
begin
  select user_id into post_owner from public.posts where id = new.post_id;
  if post_owner is not null and post_owner <> new.user_id then
    insert into public.notifications (recipient_id, actor_id, kind, post_id)
    values (post_owner, new.user_id, 'comment', new.post_id);
  end if;
  return new;
end;
$$;

drop trigger if exists notify_new_member_after_profile_insert on public.profiles;
create trigger notify_new_member_after_profile_insert
  after insert on public.profiles for each row execute function public.notify_new_member();
drop trigger if exists notify_new_follower on public.follows;
create trigger notify_new_follower
  after insert on public.follows for each row execute function public.notify_new_follow();
drop trigger if exists notify_post_like on public.post_likes;
create trigger notify_post_like
  after insert on public.post_likes for each row execute function public.notify_new_post_like();
drop trigger if exists notify_post_comment on public.post_comments;
create trigger notify_post_comment
  after insert on public.post_comments for each row execute function public.notify_new_post_comment();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;
