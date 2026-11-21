begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'attendant@shop.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000b1';
insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('40000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44),
  ('40000000-0000-0000-0000-000000000002', 'W2', 'wash', 8, 0.56, null, 44),
  ('40000000-0000-0000-0000-000000000003', 'D1', 'dry', 12, 0.37, 7.8, null);
insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from) values
  ('service', null, 'wash', 8, 'clean', 80, 30, '2025-01-01'),
  ('service', null, 'dry', 12, 'dry', 60, 40, '2025-01-01');
insert into public.utility_rates (kind, rate, effective_from) values ('electricity', 12, '2025-01-01'), ('water', 30, '2025-01-01');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';

-- phone handling and the order id
select is(public.normalize_phone('+63 917-123-4567'), '09171234567', 'international numbers are normalised');
select is(public.normalize_phone('0917 123 4567'), '09171234567', 'spaces are ignored');
select is(public.normalize_phone('12345'), null, 'a bad number is rejected');

select throws_ilike($$ select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 0, 0, null, '  ', '09171234567') $$,
  '%customer name%', 'a name is required');
select throws_ilike($$ select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 0, 0, null, 'Maria', '123') $$,
  '%mobile number%', 'a valid phone is required');

select lives_ok($$ select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 0, 0, null, 'Maria Santos', '+63 917 123 4567') $$,
  'a new customer opens an order');
select lives_ok($$ select public.create_ticket('40000000-0000-0000-0000-000000000002', 'clean', 0, 0, null, ' maria santos ', '0917 123 4567') $$,
  'the same customer joins their open order');
reset role;

select is((select count(*) from public.orders), 1::bigint, 'one order holds both jobs');
select is((select count(distinct order_id) from public.tickets), 1::bigint, 'both jobs point at it');
select is((select id from public.orders),
  floor(extract(epoch from ((select opened_at from public.orders) at time zone 'Asia/Manila' - timestamp '1899-12-30')))::bigint,
  'the order id is the opening time as whole Excel-serial seconds');
do $$ begin perform set_config('t.o', (select id::text from public.orders), false); end $$;

-- staff see open orders; a second order for the dryer
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select lives_ok(format($$ select public.create_ticket('40000000-0000-0000-0000-000000000003', 'dry', 0, 0, %s) $$, current_setting('t.o')),
  'a job can join an open order by id');
select throws_ilike($$ select public.create_ticket('40000000-0000-0000-0000-000000000003', 'dry', 0, 0, 99) $$,
  '%closed or does not exist%', 'an unknown order is refused');
select is((select count(*) from public.orders), 1::bigint, 'staff can read open orders');
reset role;

-- pay_order: blocked while a machine is running
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ilike(format($$ select public.pay_order(%s, 100, 'cash', null) $$, current_setting('t.o')),
  '% is still running%', 'the whole order cannot be paid while a machine is running');
reset role;

-- time passes: every job has finished
set local session_replication_role = replica;
update public.tickets set started_at = now() - interval '3 hours', ends_at = now() - interval '2 hours';
set local session_replication_role = origin;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ilike(format($$ select public.pay_order(%s, 100, 'gcash', null) $$, current_setting('t.o')),
  '%reference number%', 'non-cash needs a reference');
select lives_ok(format($$ select public.pay_order(%s, 225, 'gcash', 'GC-7788') $$, current_setting('t.o')),
  'the whole order is paid in one go (total 220, customer paid 225)');
reset role;

select is((select count(*) from public.tickets where status = 'completed' and reference_no = 'GC-7788'), 3::bigint,
  'every job carries the payment');
select is((select sum(amount_paid) from public.tickets), 225::numeric, 'the amounts add up to what was paid');
select is((select count(*) from public.tickets where amount_paid <> total), 1::bigint,
  'the difference lands on a single job (the last one)');
select is((select status::text from public.orders), 'closed', 'the order closes when its last job is paid');

-- a closed order takes no more jobs; the same customer then gets a new order
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}';
select throws_ilike(format($$ select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 0, 0, %s) $$, current_setting('t.o')),
  '%closed or does not exist%', 'a closed order takes no more jobs');
select lives_ok($$ select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 0, 0, null, 'Maria Santos', '09171234567') $$,
  'the same customer starts a fresh order');
reset role;
select is((select count(*) from public.orders), 2::bigint, 'there are now two orders');

-- the repeated-reference check treats one payment for a whole order as one use
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}';
select is((select max(times_used) from public.dq_repeated_references), 1::bigint,
  'a shared order payment is not flagged as a repeated reference');
reset role;

select * from finish();
rollback;
