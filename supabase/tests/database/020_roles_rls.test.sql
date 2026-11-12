begin;
create extension if not exists pgtap with schema extensions;
select plan(39);

-- fixtures (as the database owner) ----------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'attendant@shop.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'gone@shop.test');
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b4', 'named@shop.test', '{"display_name":"Maria"}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000b3';

insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('10000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44),
  ('10000000-0000-0000-0000-000000000002', 'D1', 'dry', 12, 0.37, 7.8, null);
insert into public.price_list (kind, machine_type, size_kg, level, price, default_minutes, effective_from)
  values ('service', 'wash', 8, 'clean', 80, 30, '2026-01-01');
insert into public.utility_rates (kind, rate, effective_from) values ('electricity', 15.0615, '2026-10-01');
insert into public.restocks (item, doses, unit_cost, created_by)
  values ('detergent', 10, 6, '00000000-0000-0000-0000-0000000000b1');
insert into public.audit_log (table_name, row_id, action) values ('tickets', 'x', 'insert');
insert into public.tickets (id, kind, machine_id, level, started_at, base_minutes, service_price, created_by)
  values ('20000000-0000-0000-0000-000000000001', 'machine', '10000000-0000-0000-0000-000000000001', 'clean',
          '2026-11-12 08:00+08', 30, 80, '00000000-0000-0000-0000-0000000000b2');
insert into public.tickets (id, kind, machine_id, level, started_at, base_minutes, service_price, status,
          completed_at, completed_by, amount_paid, payment_method, created_by)
  values ('20000000-0000-0000-0000-000000000002', 'machine', '10000000-0000-0000-0000-000000000002', 'dry',
          '2026-11-12 08:00+08', 30, 90, 'completed', '2026-11-12 09:00+08',
          '00000000-0000-0000-0000-0000000000b2', 90, 'cash', '00000000-0000-0000-0000-0000000000b2');

-- signup trigger ------------------------------------------------------------------
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
          'staff', 'a new user becomes staff');
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'),
          'attendant', 'display name falls back to the email name');
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000b4'),
          'Maria', 'display name comes from signup metadata when given');
select throws_ilike($$ update public.profiles set role = 'staff' where id = '00000000-0000-0000-0000-0000000000b1' $$,
          '%last active admin%', 'the last admin cannot be demoted');
select throws_ilike($$ update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000b1' $$,
          '%last active admin%', 'the last admin cannot be deactivated');

-- signed out ----------------------------------------------------------------------
set local role anon;
select throws_ilike($$ select * from public.machines $$, '%permission denied%', 'signed-out visitors cannot read machines');
select throws_ilike($$ select * from public.tickets $$, '%permission denied%', 'signed-out visitors cannot read tickets');
reset role;

-- deactivated user ----------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}';
select is(public.app_role()::text, null, 'a deactivated user has no role');
select is((select count(*)::int from public.machines), 0, 'a deactivated user reads nothing');
reset role;

-- staff ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select is(public.app_role()::text, 'staff', 'staff has the staff role');
select is((select count(*)::int from public.machines), 2, 'staff can read machines');
select is((select count(*)::int from public.price_list), 1, 'staff can read the price list');
select is((select count(*)::int from public.tickets), 1, 'staff see only open tickets');
select is((select count(*)::int from public.profiles), 1, 'staff see only their own profile');
select is((select count(*)::int from public.restocks), 0, 'staff cannot read restock costs');
select is((select count(*)::int from public.utility_rates), 0, 'staff cannot read utility rates');
select is((select count(*)::int from public.settings), 0, 'staff cannot read settings');
select is((select count(*)::int from public.audit_log), 0, 'staff cannot read the audit log');
select is((select doses from public.stock_levels() where item = 'detergent'), 10, 'staff can read stock quantities');
select throws_ilike($$ select public.stock_balance('detergent') $$, '%permission denied%', 'staff cannot call the internal stock function');
select throws_ilike($$ insert into public.machines (label, type, capacity_kg, motor_kw, element_kw)
          values ('D9', 'dry', 12, 0.37, 7.8) $$, '%row-level security%', 'staff cannot add machines');
select lives_ok($$ update public.price_list set price = 1 $$, 'a staff price update is accepted but matches no rows');
select lives_ok($$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2' $$,
          'a staff self-promotion is accepted but matches no rows');
select throws_ilike($$ insert into public.tickets (kind, machine_id, level, base_minutes, service_price, created_by)
          values ('machine', '10000000-0000-0000-0000-000000000001', 'clean', 30, 80,
                  '00000000-0000-0000-0000-0000000000b2') $$, '%permission denied%', 'staff cannot write tickets directly');
select throws_ilike($$ update public.tickets set extra_spin_count = 1 $$, '%permission denied%',
          'staff cannot update tickets directly');
reset role;
select is((select price from public.price_list limit 1), 80.00::numeric, 'staff did not change prices');
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'staff',
          'staff did not promote themselves');

-- admin ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is(public.app_role()::text, 'admin', 'admin has the admin role');
select is((select count(*)::int from public.tickets), 2, 'admin sees every ticket');
select is((select count(*)::int from public.profiles), 4, 'admin sees every profile');
select is((select count(*)::int from public.restocks), 1, 'admin can read restocks');
select is((select count(*)::int from public.utility_rates), 1, 'admin can read utility rates');
select is((select count(*)::int from public.settings), 1, 'admin can read settings');
select is((select count(*)::int from public.audit_log), 1, 'admin can read the audit log');
select lives_ok($$ insert into public.machines (label, type, capacity_kg, motor_kw, element_kw)
          values ('D9', 'dry', 12, 0.37, 7.8) $$, 'admin can add machines');
select lives_ok($$ update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b2' $$,
          'admin can promote a user');
select throws_ilike($$ insert into public.tickets (kind, machine_id, level, base_minutes, service_price, created_by)
          values ('machine', '10000000-0000-0000-0000-000000000001', 'clean', 30, 80,
                  '00000000-0000-0000-0000-0000000000b1') $$, '%permission denied%',
          'even admin writes tickets only through functions');
select throws_ilike($$ delete from public.profiles $$, '%permission denied%', 'profiles cannot be deleted through the API');
reset role;
select is((select role::text from public.profiles where id = '00000000-0000-0000-0000-0000000000b2'), 'admin',
          'the promotion took effect');

select * from finish();
rollback;
