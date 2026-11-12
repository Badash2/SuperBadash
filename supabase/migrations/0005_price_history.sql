-- Price history for the product card and "price changes for you".
-- price_changes holds a row only when a price changes (with the old/new price). For a chart over a time range,
-- each store also needs its last price before the range starts - otherwise the line would start "from nowhere".

create index if not exists ix_price_changes_code_time on public.price_changes (code, changed_at);

create or replace function public.product_history(p_code text, p_days integer default 90)
returns table (store_key text, changed_at text, old_price real, new_price real)
language sql stable security invoker set search_path = public as $$
    with bounds as (
        select to_char((now() at time zone 'utc') - make_interval(days => greatest(1, least(p_days, 3650))),
                       'YYYY-MM-DD"T"HH24:MI:SS') as since)
    select pc.store_key, pc.changed_at, pc.old_price, pc.new_price
    from price_changes pc, bounds b
    where pc.code = p_code and pc.changed_at >= b.since
    union all
    -- the starting point of every store: its last price before the range
    (select distinct on (pc.store_key) pc.store_key, pc.changed_at, pc.old_price, pc.new_price
     from price_changes pc, bounds b
     where pc.code = p_code and pc.changed_at < b.since
     order by pc.store_key, pc.changed_at desc)
    order by 1, 2;
$$;

-- Real changes (not the first recording) in the last X days, for a set of products
create or replace function public.recent_changes(codes text[], p_days integer default 7)
returns table (code text, store_key text, changed_at text, old_price real, new_price real)
language sql stable security invoker set search_path = public as $$
    select pc.code, pc.store_key, pc.changed_at, pc.old_price, pc.new_price
    from price_changes pc
    where pc.code = any(codes)
      and pc.old_price is not null
      and abs(pc.new_price - pc.old_price) > 0.001
      and pc.changed_at >= to_char((now() at time zone 'utc') - make_interval(days => greatest(1, least(p_days, 365))),
                                   'YYYY-MM-DD"T"HH24:MI:SS')
    order by pc.changed_at desc;
$$;

do $$
declare f text;
begin
    foreach f in array array['product_history(text, integer)', 'recent_changes(text[], integer)']
    loop
        execute format('revoke all on function public.%s from public, anon', f);
        execute format('grant execute on function public.%s to authenticated', f);
    end loop;
end $$;
