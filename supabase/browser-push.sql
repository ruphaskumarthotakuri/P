-- Apply after member-features.sql.
begin;
alter table public.notifications add column if not exists comment_id uuid
  references public.post_comments(id) on delete set null;

create or replace function public.notify_new_post_comment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (recipient_id, actor_id, kind, post_id, comment_id)
  select user_id, new.user_id, 'comment', new.post_id, new.id
  from public.posts where id = new.post_id and user_id <> new.user_id;
  return new;
end;
$$;

create table if not exists public.browser_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  keys jsonb not null
);
create index if not exists browser_push_user_idx on public.browser_push_subscriptions(user_id);
alter table public.browser_push_subscriptions enable row level security;
revoke all on public.browser_push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.browser_push_subscriptions to service_role;
commit;
