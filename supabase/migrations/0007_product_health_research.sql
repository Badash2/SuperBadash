-- Health, notes and "research" for products.
-- 1) product_info: more fields from Open Food Facts (ingredients, additives, processing level, carbohydrates, fibre, back-of-pack images)
-- 2) health_prefs: each person tunes the thresholds (high calories, "protein", "processed")
-- 3) product_notes: family notes on a product
-- 4) research_requests + product_research: "search for me in the next round" / an uploaded photo -> the scheduled round
--    (a Claude session) reads the images, searches for reviews, and writes back the results
-- 5) a private bucket for back-of-pack photos (family only)

alter table public.product_info add column if not exists carbs_100g numeric;
alter table public.product_info add column if not exists fiber_100g numeric;
alter table public.product_info add column if not exists ingredients_text text;
alter table public.product_info add column if not exists ingredients_n integer;
alter table public.product_info add column if not exists additives text[];
alter table public.product_info add column if not exists nova integer;
alter table public.product_info add column if not exists image_ingredients_url text;
alter table public.product_info add column if not exists image_nutrition_url text;
alter table public.product_info add column if not exists v integer not null default 1;

create table if not exists public.health_prefs (
    email                text primary key,
    kcal_high            integer not null default 400,   -- above this per 100g = "high calorie"
    protein_good         numeric not null default 10,    -- grams of protein per 100 kcal at least = "a protein product"
    processed_max_ingr   integer not null default 8,     -- more ingredients than this = "processed"
    flag_additives       boolean not null default true,  -- additives (E numbers, stabilisers, preservatives) = "ultra-processed"
    red_labels           boolean not null default true,  -- show the Ministry of Health red labels
    updated_at           timestamptz not null default now());

create table if not exists public.product_notes (
    id         uuid primary key default gen_random_uuid(),
    code       text not null,
    body       text not null check (length(body) between 1 and 1000),
    author     text not null default coalesce(auth.jwt() ->> 'email', ''),
    created_at timestamptz not null default now());
create index if not exists ix_product_notes_code on public.product_notes (code, created_at);

-- A request to the scheduled round: search for info / process uploaded photos
create table if not exists public.research_requests (
    id           uuid primary key default gen_random_uuid(),
    code         text not null,
    name         text,
    kind         text not null default 'search' check (kind in ('search', 'photo')),
    photo_path   text,                      -- path in the product-photos bucket
    note         text,
    requested_by text not null default coalesce(auth.jwt() ->> 'email', ''),
    requested_at timestamptz not null default now(),
    status       text not null default 'pending' check (status in ('pending', 'done', 'failed')),
    result_note  text,
    done_at      timestamptz);
create index if not exists ix_research_requests_pending on public.research_requests (status, requested_at);

-- Research results (overrides the Open Food Facts data where it exists)
create table if not exists public.product_research (
    code              text primary key,
    ingredients_text  text,
    ingredients_n     integer,
    additives         text[],
    processing        text check (processing in ('minimal', 'processed', 'ultra')),
    nutrition         jsonb,                -- {kcal, protein, fat, sat_fat, carbs, sugars, fiber, sodium_mg} per 100g/ml
    reviews_summary   text,
    reviews_score     numeric,              -- 0-5, if found
    reviews_count     integer,
    review_sources    jsonb,                -- [{title, url}]
    sources           jsonb,                -- where the data came from (OFF image / family photo / website)
    updated_at        timestamptz not null default now());

-- ---------- RLS ----------
alter table public.health_prefs enable row level security;
alter table public.product_notes enable row level security;
alter table public.research_requests enable row level security;
alter table public.product_research enable row level security;
revoke all on public.health_prefs, public.product_notes, public.research_requests, public.product_research from anon;

drop policy if exists own_rows on public.health_prefs;
create policy own_rows on public.health_prefs for all to authenticated
    using ((select public.is_family()) and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    with check ((select public.is_family()) and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select, insert, update, delete on public.health_prefs to authenticated;

-- notes and requests: the whole family reads and adds; deleting - only what you wrote yourself
do $$
declare t text;
begin
    foreach t in array array['product_notes', 'research_requests']
    loop
        execute format('drop policy if exists family_read on public.%I', t);
        execute format('drop policy if exists family_insert on public.%I', t);
        execute format('drop policy if exists own_delete on public.%I', t);
        execute format('create policy family_read on public.%I for select to authenticated using ((select public.is_family()))', t);
        execute format('create policy family_insert on public.%I for insert to authenticated with check ((select public.is_family()))', t);
        execute format('grant select, insert, delete on public.%I to authenticated', t);
    end loop;
end $$;
create policy own_delete on public.product_notes for delete to authenticated
    using ((select public.is_family()) and lower(author) = lower(coalesce(auth.jwt() ->> 'email', '')));
create policy own_delete on public.research_requests for delete to authenticated
    using ((select public.is_family()) and status = 'pending' and lower(requested_by) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists family_read on public.product_research;
create policy family_read on public.product_research for select to authenticated using ((select public.is_family()));
grant select on public.product_research to authenticated;   -- writing: only the scheduled round (secret key)

-- product_info: the client fills it from Open Food Facts (already allowed); nothing new to open up

-- ---------- a bucket for back-of-pack photos (only where Supabase Storage exists) ----------
do $$
begin
    if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
        insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
        values ('product-photos', 'product-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
        on conflict (id) do nothing;
        execute 'drop policy if exists "family read product photos" on storage.objects';
        execute 'drop policy if exists "family upload product photos" on storage.objects';
        execute $p$create policy "family read product photos" on storage.objects for select to authenticated
                 using (bucket_id = 'product-photos' and (select public.is_family()))$p$;
        execute $p$create policy "family upload product photos" on storage.objects for insert to authenticated
                 with check (bucket_id = 'product-photos' and (select public.is_family()))$p$;
    end if;
end $$;
