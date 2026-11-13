-- Privileges for the service role (the Supabase secret key: the notification server in Vercel and the research round).
-- At setup we turned off "Automatically expose new tables", so the tables created by the migrations
-- didn't get privileges for service_role either - and the server got "permission denied".
-- service_role bypasses RLS by definition; here we give it only the basic table-level privileges.
-- (anon and authenticated are unaffected: the access rules for them stay as they were, via RLS + explicit grants.)
do $$
begin
    if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant usage on schema public to service_role';
        execute 'grant select, insert, update, delete on all tables in schema public to service_role';
        execute 'grant usage, select on all sequences in schema public to service_role';
        execute 'grant execute on all functions in schema public to service_role';
        -- tables/functions that future migrations create (by the admin user) get the same privileges automatically
        execute 'alter default privileges in schema public grant select, insert, update, delete on tables to service_role';
        execute 'alter default privileges in schema public grant usage, select on sequences to service_role';
        execute 'alter default privileges in schema public grant execute on functions to service_role';
    end if;
end $$;
