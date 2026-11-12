-- Notifications: each family member picks what they get (Web Push to their device).
-- Sending happens on the server (Vercel route handlers with the secret key); the client only manages its own settings.

-- Personal settings (one row per user)
create table if not exists public.notification_prefs (
    email        text primary key,
    list_adds    text not null default 'in_store' check (list_adds in ('off', 'in_store', 'always')),
    ran_out      text not null default 'daily'    check (ran_out in ('off', 'daily', 'each')),
    ran_out_from text[],                 -- null = from everyone; otherwise emails and/or 'kiosk' (an unidentified scan at the bin)
    deals        text not null default 'daily'    check (deals in ('off', 'daily', 'each')),
    deals_scope  text not null default 'ours'     check (deals_scope in ('ours', 'ours_plus_top')),
    digest_hour  integer not null default 19      check (digest_hour between 6 and 23),
    quiet        boolean not null default true,  -- no "each" notifications between 22:00 and 07:00
    updated_at   timestamptz not null default now());

-- The user's devices that approved notifications
create table if not exists public.push_subscriptions (
    endpoint     text primary key,
    email        text not null,
    p256dh       text not null,
    auth         text not null,
    user_agent   text,
    created_at   timestamptz not null default now(),
    last_ok_at   timestamptz,
    failures     integer not null default 0);
create index if not exists ix_push_subscriptions_email on public.push_subscriptions (email);

-- Who is in the store right now (for "notify me about list additions only while I'm in the store")
create table if not exists public.member_status (
    email         text primary key,
    current_store text,
    updated_at    timestamptz not null default now());

-- A log of what was sent, to prevent duplicates (also when the send endpoint is triggered more than once)
create table if not exists public.notification_log (
    email    text not null,
    kind     text not null,
    ref      text not null,
    sent_at  timestamptz not null default now(),
    primary key (email, kind, ref));

-- Who scanned at the bin (an optional choice on the scanner screen; null = unidentified)
alter table public.consumed_items add column if not exists scanned_as text;

-- ---------- RLS ----------
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.member_status enable row level security;
alter table public.notification_log enable row level security;   -- no policies: the server only
revoke all on public.notification_prefs, public.push_subscriptions, public.member_status, public.notification_log from anon;
revoke all on public.notification_log from authenticated;

-- Settings and devices: each user sees and edits only their own
do $$
declare t text;
begin
    foreach t in array array['notification_prefs', 'push_subscriptions']
    loop
        execute format('drop policy if exists own_rows on public.%I', t);
        execute format($p$create policy own_rows on public.%I for all to authenticated
            using ((select public.is_family()) and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
            with check ((select public.is_family()) and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))$p$, t);
        execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    end loop;
end $$;

-- Who is in the store: the whole family sees it (the basis for "following the shop"), each person updates only themselves
drop policy if exists family_read on public.member_status;
drop policy if exists own_write on public.member_status;
create policy family_read on public.member_status for select to authenticated using ((select public.is_family()));
create policy own_write on public.member_status for all to authenticated
    using ((select public.is_family()) and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    with check ((select public.is_family()) and lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
grant select, insert, update, delete on public.member_status to authenticated;

-- Each person can update their display name (shown on the bin scanner and the list)
drop policy if exists own_name on public.family_members;
create policy own_name on public.family_members for update to authenticated
    using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
    with check (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));
grant update (display_name) on public.family_members to authenticated;
