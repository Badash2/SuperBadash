-- SuperBadash phase 2: the family app.
-- Security: every table is locked (RLS). Only Google accounts listed in family_members
-- can read or write. The ingest job connects as the admin user and is not affected by RLS.
-- The tables of phase 1 (products, current_prices ...) are created by the ingest job itself;
-- here they are created as well (IF NOT EXISTS) so the migration also runs on an empty database.

create table if not exists public.stores (
    store_key text primary key, chain text not null, store_id text not null, name text not null, role text);
create table if not exists public.products (
    code text primary key, barcode text, name text not null, manufacturer text, quantity real, unit text,
    is_weighted integer not null default 0, updated_at text not null);
create table if not exists public.current_prices (
    store_key text not null, code text not null, price real not null, unit_price real,
    since text not null, last_seen text not null, primary key (store_key, code));
create table if not exists public.price_changes (
    store_key text not null, code text not null, changed_at text not null, old_price real, new_price real not null,
    primary key (store_key, code, changed_at));
create table if not exists public.promotions (
    store_key text not null, promo_id text not null, description text, start_at text, end_at text, club_id integer,
    is_coupon integer not null default 0, is_gift integer not null default 0, allow_multiple integer not null default 0,
    min_purchase real, item_count integer not null default 0, first_seen text not null, last_seen text not null,
    primary key (store_key, promo_id));
create table if not exists public.promo_items (
    store_key text not null, promo_id text not null, code text not null, min_qty real, discounted_price real,
    discount_rate real, reward_type integer, primary key (store_key, promo_id, code));
create table if not exists public.ingest_runs (
    store_key text not null, kind text not null, file_name text not null, ingested_at text not null,
    rows integer not null, changes integer not null, primary key (store_key, kind, file_name));

-- Deal-engine output (written by `superbadash publish-deals` after every ingest)
create table if not exists public.deals (
    store_key text not null, code text not null, promo_id text, description text,
    regular_price real, promo_unit_price real, min_qty real, discount_pct real, market_saving_pct real,
    verdict text not null, flags text, end_at text, computed_at text not null,
    primary key (store_key, code));

create index if not exists ix_current_prices_code on public.current_prices (code);
create index if not exists ix_current_prices_snapshot on public.current_prices (store_key, last_seen);
create index if not exists ix_deals_code on public.deals (code);

-- ---------- family ----------
create table if not exists public.family_members (
    email text primary key,
    display_name text,
    added_at timestamptz not null default now());

insert into public.family_members (email, display_name) values
    ('badash2@gmail.com', 'אבא'),
    ('odelyamor@gmail.com', 'אודליה'),
    ('totobadash@gmail.com', null),
    ('lwllybadash@gmail.com', null)
on conflict (email) do nothing;

create or replace function public.is_family() returns boolean
language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from public.family_members
        where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
$$;
revoke all on function public.is_family() from public;
grant execute on function public.is_family() to authenticated;

-- ---------- shopping list ----------
create table if not exists public.shopping_items (
    id uuid primary key default gen_random_uuid(),
    code text,                       -- barcode / product code (null = free text)
    name text not null,
    quantity numeric not null default 1,
    note text,
    added_by text not null default coalesce(auth.jwt() ->> 'email', ''),
    added_at timestamptz not null default now(),
    checked boolean not null default false,
    checked_at timestamptz,
    checked_by text,
    checked_store text);

-- Purchase history: each "finish shopping" becomes a trip. seq = order of ticking (to learn the aisle order)
create table if not exists public.purchases (
    id bigint generated always as identity primary key,
    trip_id uuid not null,
    code text,
    name text not null,
    quantity numeric,
    store_key text,
    seq integer,
    purchased_at timestamptz not null default now(),
    purchased_by text);
create index if not exists ix_purchases_store on public.purchases (store_key);

-- Image / nutrition cache (filled by the client from Open Food Facts)
create table if not exists public.product_info (
    code text primary key,
    found boolean not null default true,
    off_name text,
    image_url text,
    kcal_100g numeric,
    protein_100g numeric,
    sugar_100g numeric,
    fat_100g numeric,
    sat_fat_100g numeric,
    sodium_100g numeric,
    nutriscore text,
    fetched_at timestamptz not null default now());

-- ---------- RLS ----------
do $$
declare t text;
begin
    foreach t in array array['stores','products','current_prices','price_changes','promotions','promo_items',
                             'ingest_runs','deals','family_members','shopping_items','purchases','product_info']
    loop
        execute format('alter table public.%I enable row level security', t);
        execute format('revoke all on public.%I from anon', t);
    end loop;

    -- read: family only. (select is_family()) = evaluated once per query, not per row
    foreach t in array array['stores','products','current_prices','price_changes','promotions','promo_items',
                             'deals','family_members','shopping_items','purchases','product_info']
    loop
        execute format('drop policy if exists family_read on public.%I', t);
        execute format('create policy family_read on public.%I for select to authenticated using ((select public.is_family()))', t);
        execute format('grant select on public.%I to authenticated', t);
    end loop;

    -- write: family only, on the family's own tables
    foreach t in array array['shopping_items','purchases','product_info']
    loop
        execute format('drop policy if exists family_insert on public.%I', t);
        execute format('drop policy if exists family_update on public.%I', t);
        execute format('drop policy if exists family_delete on public.%I', t);
        execute format('create policy family_insert on public.%I for insert to authenticated with check ((select public.is_family()))', t);
        execute format('create policy family_update on public.%I for update to authenticated using ((select public.is_family())) with check ((select public.is_family()))', t);
        execute format('create policy family_delete on public.%I for delete to authenticated using ((select public.is_family()))', t);
        execute format('grant insert, update, delete on public.%I to authenticated', t);
    end loop;
end $$;

-- ---------- functions for the site (security invoker = RLS applies) ----------

-- Search products. All words must appear in the name; or a barcode.
create or replace function public.search_products(q text, lim integer default 20)
returns table (code text, barcode text, name text, manufacturer text, quantity real, unit text,
               is_weighted boolean, min_price real, store_count integer)
language sql stable security invoker set search_path = public as $$
    with snap as (select s.store_key, (select max(c.last_seen) from current_prices c where c.store_key = s.store_key) as ts from stores s),
    terms as (select t from unnest(string_to_array(btrim(q), ' ')) as t where t <> '')
    select p.code, p.barcode, p.name, p.manufacturer, p.quantity, p.unit, p.is_weighted = 1,
           min(cp.price), count(*)::integer
    from products p
    join current_prices cp on cp.code = p.code
    join snap s on s.store_key = cp.store_key and s.ts = cp.last_seen
    where case when btrim(q) ~ '^[0-9]{6,14}$'
               then p.barcode = ltrim(btrim(q), '0') or p.code like '%:' || btrim(q)
               else not exists (select 1 from terms where p.name not ilike '%' || terms.t || '%')
          end
    group by p.code, p.barcode, p.name, p.manufacturer, p.quantity, p.unit, p.is_weighted
    order by count(*) desc, length(p.name)
    limit greatest(1, least(lim, 50));
$$;

-- Prices for a set of products in every store (latest snapshot) + the deal-engine verdict
create or replace function public.prices_for(codes text[])
returns table (code text, store_key text, price real, promo_unit_price real, verdict text,
               promo_description text, min_qty real, flags text, end_at text)
language sql stable security invoker set search_path = public as $$
    with snap as (select s.store_key, (select max(c.last_seen) from current_prices c where c.store_key = s.store_key) as ts from stores s)
    select cp.code, cp.store_key, cp.price, d.promo_unit_price, d.verdict, d.description, d.min_qty, d.flags, d.end_at
    from current_prices cp
    join snap s on s.store_key = cp.store_key and s.ts = cp.last_seen
    left join deals d on d.store_key = cp.store_key and d.code = cp.code
    where cp.code = any(codes);
$$;

-- Learned aisle order per store: the average relative position of the product in past trips
create or replace function public.aisle_order(p_store text)
returns table (item_key text, pos real, trips integer)
language sql stable security invoker set search_path = public as $$
    with t as (
        select coalesce(code, name) as item_key, seq,
               max(seq) over (partition by trip_id) as trip_len, trip_id
        from purchases where store_key = p_store and seq is not null)
    select item_key, avg(case when trip_len > 0 then seq::real / trip_len else 0 end)::real,
           count(distinct trip_id)::integer
    from t group by item_key;
$$;

-- Data status: when each store was last updated
create or replace function public.data_status()
returns table (store_key text, name text, prices_at text, items integer)
language sql stable security invoker set search_path = public as $$
    select s.store_key, s.name, max(cp.last_seen), count(*)::integer
    from stores s join current_prices cp on cp.store_key = s.store_key
    group by s.store_key, s.name;
$$;

do $$
declare f text;
begin
    foreach f in array array['search_products(text, integer)', 'prices_for(text[])', 'aisle_order(text)', 'data_status()']
    loop
        execute format('revoke all on function public.%s from public, anon', f);
        execute format('grant execute on function public.%s to authenticated', f);
    end loop;
end $$;

-- Realtime for the shopping list (you see immediately what the others added or ticked)
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
       and not exists (select 1 from pg_publication_tables
                       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopping_items') then
        execute 'alter publication supabase_realtime add table public.shopping_items';
    end if;
end $$;
