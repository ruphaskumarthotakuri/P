-- Create a private bucket for profile images. Existing buckets are left unchanged.
insert into storage.buckets (id, name, public)
values ('photo', 'photo', false)
on conflict (id) do nothing;

create policy "Users can view their own profile images"
on storage.objects for select
to authenticated
using (
  bucket_id = 'photo'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can upload their own profile images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'photo'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "Users can update their own profile images"
on storage.objects for update
to authenticated
using (
  bucket_id = 'photo'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'photo'
  and (storage.foldername(name))[1] = auth.uid()::text
);
