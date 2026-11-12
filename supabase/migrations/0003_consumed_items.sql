-- Phase 3: the scanner by the bin. Every scan = "this product ran out", with the time.
-- The site shows "ran out recently" with quick add to the list; the data also builds
-- each product's consumption rate (how often milk runs out) for later predictions.
create table if not exists public.consumed_items (
    id uuid primary key default gen_random_uuid(),
    code text not null,
    name text not null,
    scanned_at timestamptz not null default now(),
    scanned_by text not null default coalesce(auth.jwt() ->> 'email', ''),
    device text,
    status text not null default 'new' check (status in ('new', 'added', 'dismissed')),
    handled_at timestamptz);

create index if not exists ix_consumed_items_recent on public.consumed_items (scanned_at desc);
create index if not exists ix_consumed_items_code on public.consumed_items (code, scanned_at);

alter table public.consumed_items enable row level security;
revoke all on public.consumed_items from anon;
drop policy if exists family_read on public.consumed_items;
drop policy if exists family_insert on public.consumed_items;
drop policy if exists family_update on public.consumed_items;
drop policy if exists family_delete on public.consumed_items;
create policy family_read on public.consumed_items for select to authenticated using ((select public.is_family()));
create policy family_insert on public.consumed_items for insert to authenticated with check ((select public.is_family()));
create policy family_update on public.consumed_items for update to authenticated
    using ((select public.is_family())) with check ((select public.is_family()));
create policy family_delete on public.consumed_items for delete to authenticated using ((select public.is_family()));
grant select, insert, update, delete on public.consumed_items to authenticated;

-- Realtime: a scan by the bin shows up on the site immediately
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'consumed_items') then
        execute 'alter publication supabase_realtime add table public.consumed_items';
    end if;
end $$;
