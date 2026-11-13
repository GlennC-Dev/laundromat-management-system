begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- fixtures ---------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'attendant@shop.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d1';

insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle, status) values
  ('10000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44, 'available'),
  ('10000000-0000-0000-0000-000000000002', 'D1', 'dry', 12, 0.37, 7.8, null, 'available'),
  ('10000000-0000-0000-0000-000000000003', 'W2', 'wash', 12, 0.75, null, 60, 'out_of_service');

insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from) values
  ('service', null, 'wash', 8,  'clean', 80, 30, '2025-01-01'),
  ('service', null, 'wash', 12, 'clean', 110, 35, '2025-01-01'),
  ('service', null, 'dry',  12, 'dry',   60, 40, '2025-01-01'),
  ('add_on', 'extra_spin', 'wash', null, null, 15, 5, '2025-01-01'),
  ('add_on', 'dry_extension', 'dry', 12, null, 10, 5, '2025-01-01'),
  ('item', 'detergent', null, null, null, 12, null, '2025-01-01'),
  ('item', 'detergent', null, null, null, 15, null, '2026-01-01'),
  ('item', 'detergent', null, null, null, 20, null, '2099-01-01'),
  ('item', 'fabcon', null, null, null, 10, null, '2025-01-01');
insert into public.restocks (item, doses, unit_cost, created_by) values
  ('detergent', 10, 6, '00000000-0000-0000-0000-0000000000d1'),
  ('fabcon', 5, 4, '00000000-0000-0000-0000-0000000000d1');

-- as staff ---------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';

select lives_ok($$ select public.create_ticket('10000000-0000-0000-0000-000000000001', 'clean', 2, 0) $$,
  'staff can create a wash ticket');
reset role;
do $$ begin perform set_config('t.w1', (select id::text from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'), false); end $$;
select is((select service_price from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'), 80.00::numeric,
  'the service price is snapshotted onto the ticket');
select is((select base_minutes from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'), 30,
  'the duration comes from the price list');
select is((select detergent_unit_price from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'), 15.00::numeric,
  'the detergent price in effect today is used, not an old or future one');
select is((select created_by from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000d2'::uuid, 'the attendant is recorded');
select is((select (started_at = now())::text from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'),
  'true', 'the start time is set by the server');
select is((select count(*)::int from public.audit_log where table_name = 'tickets' and action = 'create'
           and actor = '00000000-0000-0000-0000-0000000000d2'), 1, 'creation is audited with the actor');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select throws_ilike($$ select public.create_ticket('10000000-0000-0000-0000-000000000001', 'clean') $$,
  '%machine W1 is busy until%', 'a busy machine cannot take a second ticket');
select throws_ilike($$ select public.create_ticket('10000000-0000-0000-0000-000000000003', 'clean') $$,
  '%not available%', 'an out-of-service machine cannot take a ticket');
select throws_ilike($$ select public.create_ticket('10000000-0000-0000-0000-000000000002', 'driest') $$,
  '%no price set%', 'a missing price is reported');
select throws_ilike($$ select public.create_ticket('10000000-0000-0000-0000-000000000002', 'clean') $$,
  '%does not match%', 'a washer level on a dryer is rejected');
select throws_ilike($$ select public.create_ticket('10000000-0000-0000-0000-000000000001', 'clean', 99, 0) $$,
  '%out of stock%', 'a ticket cannot use more detergent than is in stock');

-- adding to a ticket -------------------------------------------------------------------------
select lives_ok($$ select public.add_to_ticket(current_setting('t.w1')::uuid, 0, 2, 0, 1) $$,
  'a pending ticket can gain spins and fabcon');
reset role;
select is((select total from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'),
  150.00::numeric, 'total = 80 service + 2 x 15 detergent + 2 x 15 spins + 1 x 10 fabcon');
select is((select ends_at from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'),
  now() + interval '40 minutes', 'spins extend the scheduled end');

-- a price change never touches existing tickets, and applies to new ones
insert into public.price_list (kind, code, price, effective_from)
  values ('item', 'detergent', 99, (now() at time zone 'Asia/Manila')::date);
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select lives_ok($$ select public.add_to_ticket(current_setting('t.w1')::uuid, 0, 0, 1, 0) $$,
  'more detergent can be added');
reset role;
select is((select detergent_unit_price from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'),
  15.00::numeric, 'later additions keep the price snapshotted on the ticket');
select is((select detergent_qty from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'), 3,
  'the quantities add up');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select lives_ok($$ select public.create_ticket('10000000-0000-0000-0000-000000000002', 'dry', 1, 0) $$, 'staff can create a dry ticket');
reset role;
do $$ begin perform set_config('t.d1', (select id::text from public.tickets where machine_id = '10000000-0000-0000-0000-000000000002'), false); end $$;
select is((select detergent_unit_price from public.tickets where machine_id = '10000000-0000-0000-0000-000000000002'),
  99.00::numeric, 'a new ticket picks up the new price');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select throws_ilike($$ select public.add_to_ticket(current_setting('t.d1')::uuid, 0, 1, 0, 0) $$,
  '%washers only%', 'spins cannot be added to a dryer ticket');
select throws_ilike($$ select public.add_to_ticket(current_setting('t.w1')::uuid, 10, 0, 0, 0) $$,
  '%dryers only%', 'dry minutes cannot be added to a washer ticket');
select throws_ilike($$ select public.add_to_ticket(current_setting('t.d1')::uuid, 7, 0, 0, 0) $$,
  '%5-minute steps%', 'extra dry time comes in 5-minute steps');
select throws_ilike($$ select public.add_to_ticket(current_setting('t.d1')::uuid, 0, 0, 0, 0) $$,
  '%nothing to add%', 'an empty addition is rejected');
select lives_ok($$ select public.add_to_ticket(current_setting('t.d1')::uuid, 10, 0, 0, 0) $$,
  'dry minutes can be added to a dryer ticket');

-- completing ---------------------------------------------------------------------------------
select throws_ilike($$ select public.complete_ticket(current_setting('t.w1')::uuid, 150, 'gcash') $$,
  '%reference number%', 'a non-cash payment needs a reference');
select lives_ok($$ select public.complete_ticket(current_setting('t.w1')::uuid, 150, 'gcash', 'GC-1234') $$,
  'a ticket can be completed with payment details');
select throws_ilike($$ select public.add_to_ticket(current_setting('t.w1')::uuid, 0, 1, 0, 0) $$,
  '%only a pending ticket%', 'a completed ticket cannot gain add-ons');
select throws_ilike($$ select public.complete_ticket(current_setting('t.w1')::uuid, 150, 'cash') $$,
  '%already completed%', 'a ticket cannot be completed twice');
reset role;
select is((select completed_by from public.tickets where machine_id = '10000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-0000000000d2'::uuid, 'the completing attendant is recorded');

-- counter sales ------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select throws_ilike($$ select public.counter_sale(0, 0, 0, 'cash') $$, '%at least one item%', 'a counter sale needs an item');
select lives_ok($$ select public.counter_sale(0, 2, 20, 'cash') $$, 'staff can record a counter sale');
reset role;
select is((select total from public.tickets where kind = 'counter'), 20.00::numeric, 'the counter sale total uses the snapshotted price');
select is((select status::text from public.tickets where kind = 'counter'), 'completed', 'a counter sale is completed in one step');

-- voiding ------------------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}';
select throws_ilike($$ select public.void_ticket(current_setting('t.w1')::uuid, 'oops') $$,
  '%only an admin%', 'staff cannot void');
select is((select doses from public.stock_levels() where item = 'detergent'), 6, 'stock reflects the 4 detergent doses used');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}';
select throws_ilike($$ select public.void_ticket(current_setting('t.w1')::uuid, '  ') $$,
  '%needs a reason%', 'a void needs a reason');
select lives_ok($$ select public.void_ticket(current_setting('t.w1')::uuid, 'wrong machine') $$,
  'an admin can void a completed ticket');
select is((select doses from public.stock_levels() where item = 'detergent'), 9, 'a void returns its doses to stock');
select throws_ilike($$ select public.void_ticket(current_setting('t.w1')::uuid, 'again') $$,
  '%already voided%', 'a ticket cannot be voided twice');
reset role;

-- signed out ---------------------------------------------------------------------------------
set local role anon;
select throws_ilike($$ select public.create_ticket('10000000-0000-0000-0000-000000000001', 'clean') $$,
  '%permission denied%', 'signed-out visitors cannot create tickets');
reset role;

select * from finish();
rollback;
