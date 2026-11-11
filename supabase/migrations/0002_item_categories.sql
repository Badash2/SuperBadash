-- Section overrides set by the family ("this product goes in frozen"), shared by everyone.
-- item_key = barcode/product code, or the free text for items without a code.
create table if not exists public.item_categories (
    item_key text primary key,
    category text not null,
    set_by text not null default coalesce(auth.jwt() ->> 'email', ''),
    set_at timestamptz not null default now());

alter table public.item_categories enable row level security;
revoke all on public.item_categories from anon;
drop policy if exists family_read on public.item_categories;
drop policy if exists family_insert on public.item_categories;
drop policy if exists family_update on public.item_categories;
drop policy if exists family_delete on public.item_categories;
create policy family_read on public.item_categories for select to authenticated using ((select public.is_family()));
create policy family_insert on public.item_categories for insert to authenticated with check ((select public.is_family()));
create policy family_update on public.item_categories for update to authenticated
    using ((select public.is_family())) with check ((select public.is_family()));
create policy family_delete on public.item_categories for delete to authenticated using ((select public.is_family()));
grant select, insert, update, delete on public.item_categories to authenticated;
