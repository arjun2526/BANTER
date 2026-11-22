begin;

alter table public.stories
  add column if not exists media_path text,
  add column if not exists media_mime text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'banter-story-media',
  'banter-story-media',
  false,
  52428800,
  array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists banter_story_upload_own_folder on storage.objects;
create policy banter_story_upload_own_folder
on storage.objects for insert to authenticated
with check (
  bucket_id = 'banter-story-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists banter_story_read_owner_or_friend on storage.objects;
create policy banter_story_read_owner_or_friend
on storage.objects for select to authenticated
using (
  bucket_id = 'banter-story-media'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.friendships f
      where
        (f.user_a = (select auth.uid())::text and f.user_b = (storage.foldername(name))[1])
        or
        (f.user_b = (select auth.uid())::text and f.user_a = (storage.foldername(name))[1])
    )
  )
);

drop policy if exists banter_story_delete_own_folder on storage.objects;
create policy banter_story_delete_own_folder
on storage.objects for delete to authenticated
using (
  bucket_id = 'banter-story-media'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists friendships_insert_after_accepted_request on public.friendships;
create policy friendships_insert_after_accepted_request
on public.friendships for insert to authenticated
with check (
  (
    user_a = (select auth.uid())::text
    or user_b = (select auth.uid())::text
  )
  and exists (
    select 1
    from public.friend_requests fr
    where fr.status = 'accepted'
      and (
        (fr.from_user_id = friendships.user_a and fr.to_user_id = friendships.user_b)
        or
        (fr.from_user_id = friendships.user_b and fr.to_user_id = friendships.user_a)
      )
  )
);

commit;
