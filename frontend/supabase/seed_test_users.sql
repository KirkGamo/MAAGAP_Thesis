-- MAAGAP: Seed test accounts for local RBAC testing (Phase 8.5)
-- ================================================================================
-- Run this in the Supabase SQL Editor AFTER supabase/schema.sql has already
-- been applied (this script depends on public.profiles, the user_role enum,
-- and the on_auth_user_created trigger it defines).
--
-- Creates two accounts:
--   manager@maagap.test   / MaagapTest123!   -> profiles.role = 'manager'
--   inspector@maagap.test / MaagapTest123!   -> profiles.role = 'inspector' (trigger default)
--
-- CHANGE THE PASSWORD before this ever touches a non-throwaway project.
--
-- WHY THIS IS MORE FRAGILE THAN IT LOOKS
-- -----------------------------------------------
-- auth.users/auth.identities are GoTrue-managed internal tables, not part
-- of Supabase's public API contract -- their exact required columns can
-- shift between Supabase Postgres versions. The INSERTs below use the
-- fields that are broadly required across current versions (encrypted
-- password via pgcrypto, confirmed email, and a matching auth.identities
-- row so email/password sign-in resolves correctly), but if this errors on
-- your project, the more robust alternative is the Supabase Dashboard:
-- Authentication -> Users -> Add User -> create user (with the same email/
-- password, "Auto Confirm User" checked) -- then just run TASK 1B below
-- (the profiles.role update) against the user it creates.

-- Required for crypt()/gen_salt() used to hash the password below.
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- TASK 1A: Create the two auth users
-- ---------------------------------------------------------------------
do $$
declare
  manager_id uuid := gen_random_uuid();
  inspector_id uuid := gen_random_uuid();
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at, confirmation_token, email_change,
    email_change_token_new, recovery_token
  ) values
  (
    '00000000-0000-0000-0000-000000000000', manager_id, 'authenticated', 'authenticated',
    'manager@maagap.test', crypt('MaagapTest123!', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Test Manager"}',
    now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', inspector_id, 'authenticated', 'authenticated',
    'inspector@maagap.test', crypt('MaagapTest123!', gen_salt('bf')),
    now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Test Inspector"}',
    now(), now(), '', '', '', ''
  );

  insert into auth.identities (
    id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
  ) values
  (
    gen_random_uuid(), manager_id, manager_id::text,
    jsonb_build_object('sub', manager_id::text, 'email', 'manager@maagap.test'),
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(), inspector_id, inspector_id::text,
    jsonb_build_object('sub', inspector_id::text, 'email', 'inspector@maagap.test'),
    'email', now(), now(), now()
  );
end $$;

-- ---------------------------------------------------------------------
-- TASK 1B: Promote manager@maagap.test to the 'manager' role
-- ---------------------------------------------------------------------
-- on_auth_user_created (schema.sql) already fired for both users above and
-- inserted matching public.profiles rows defaulting to role='inspector' --
-- inspector@maagap.test is already correct. Only the manager needs a
-- promotion.
update public.profiles
set role = 'manager'
where id = (select id from auth.users where email = 'manager@maagap.test');

-- ---------------------------------------------------------------------
-- Verify
-- ---------------------------------------------------------------------
select u.email, p.role, p.full_name
from auth.users u
join public.profiles p on p.id = u.id
where u.email in ('manager@maagap.test', 'inspector@maagap.test');
