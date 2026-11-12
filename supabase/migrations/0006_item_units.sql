-- Quantity unit on the list: units or kg (most produce is sold by weight).
-- The client sets the default when adding (weighed product / produce = kg; packaged = units), and you can switch with one tap.
alter table public.shopping_items add column if not exists unit text not null default 'units';
alter table public.purchases add column if not exists unit text not null default 'units';
do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'shopping_items_unit_check') then
        alter table public.shopping_items add constraint shopping_items_unit_check check (unit in ('units', 'kg'));
    end if;
    if not exists (select 1 from pg_constraint where conname = 'purchases_unit_check') then
        alter table public.purchases add constraint purchases_unit_check check (unit in ('units', 'kg'));
    end if;
end $$;
