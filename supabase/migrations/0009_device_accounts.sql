-- Device accounts: an approved Google account that isn't a person - the fixed scanner by the bin.
-- It's allowed in (family_members) but isn't part of "who's scanning", the "scans from" choice in Settings, or notifications.
alter table public.family_members add column if not exists is_device boolean not null default false;

insert into public.family_members (email, display_name, is_device)
values ('badashsuper@gmail.com', 'סורק הפח', true)
on conflict (email) do update set is_device = true, display_name = coalesce(public.family_members.display_name, excluded.display_name);
