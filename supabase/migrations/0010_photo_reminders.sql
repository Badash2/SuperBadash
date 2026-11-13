-- Photo reminders from the bin scanner: an open hand -> a 10-second countdown -> a photo.
-- For things without a barcode (produce) or with a barcode that won't scan. On the site they appear under "Ran out",
-- and you choose whether to add them to the list (with a name if you like) - nothing goes in on its own.
create table if not exists public.photo_reminders (
    id          uuid primary key default gen_random_uuid(),
    photo_path  text not null,                 -- path in the product-photos bucket
    created_at  timestamptz not null default now(),
    created_by  text not null default coalesce(auth.jwt() ->> 'email', ''),
    scanned_as  text,                          -- "who's scanning" if chosen at the scanner
    status      text not null default 'new' check (status in ('new', 'added', 'dismissed')),
    item_name   text,
    handled_at  timestamptz);
create index if not exists ix_photo_reminders_recent on public.photo_reminders (created_at desc);

-- A list item can carry the photo it came from
alter table public.shopping_items add column if not exists photo_path text;

alter table public.photo_reminders enable row level security;
revoke all on public.photo_reminders from anon;
drop policy if exists family_read on public.photo_reminders;
drop policy if exists family_insert on public.photo_reminders;
drop policy if exists family_update on public.photo_reminders;
drop policy if exists family_delete on public.photo_reminders;
create policy family_read on public.photo_reminders for select to authenticated using ((select public.is_family()));
create policy family_insert on public.photo_reminders for insert to authenticated with check ((select public.is_family()));
create policy family_update on public.photo_reminders for update to authenticated
    using ((select public.is_family())) with check ((select public.is_family()));
create policy family_delete on public.photo_reminders for delete to authenticated using ((select public.is_family()));
grant select, insert, update, delete on public.photo_reminders to authenticated;

do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'photo_reminders') then
        execute 'alter publication supabase_realtime add table public.photo_reminders';
    end if;
end $$;
