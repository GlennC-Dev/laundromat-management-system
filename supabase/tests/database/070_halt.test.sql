begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'attendant@shop.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000f1';
insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('30000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44);
insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from) values
  ('service', null, 'wash', 8, 'clean', 80, 30, '2025-01-01'),
  ('item', 'detergent', null, null, null, 15, null, '2025-01-01');
insert into public.restocks (item, doses, unit_cost, created_by) values
  ('detergent', 10, 6, '00000000-0000-0000-0000-0000000000f1');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';

select lives_ok($$ select public.create_ticket('30000000-0000-0000-0000-000000000001', 'clean', 1, 0) $$, 'staff starts a job');
reset role;
do $$ begin perform set_config('t.a', (select id::text from public.tickets order by started_at desc limit 1), false); end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok(format($$ select public.halt_ticket(%L, 'other', null) $$, current_setting('t.a')),
  'P0001', 'describe the problem', 'Other needs a note');
select lives_ok(format($$ select public.halt_ticket(%L, 'machine_error', 'door sensor') $$, current_setting('t.a')),
  'staff halt a job inside the window without an admin');
reset role;

select is((select halt_reason::text from public.tickets where id = current_setting('t.a')::uuid), 'machine_error', 'halt reason is stored');
select is((select voided_by from public.tickets where id = current_setting('t.a')::uuid),
  '00000000-0000-0000-0000-0000000000f2'::uuid, 'the staff member is recorded');
select is((select void_reason from public.tickets where id = current_setting('t.a')::uuid),
  'Halted: Machine error - door sensor', 'reason label and note are combined');
select is((select count(*) from public.audit_log where action = 'halt'), 1::bigint, 'the halt is audited');
select is(public.stock_balance('detergent'), 10, 'a halted job gives its detergent back');

-- cooldown: the machine cannot start again straight away
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok($$ select public.create_ticket('30000000-0000-0000-0000-000000000001', 'clean', 0, 0) $$,
  'P0001', null, 'a just-halted machine cannot start a job');
reset role;
set local session_replication_role = replica; -- voided tickets are locked
update public.tickets set voided_at = now() - interval '2 minutes' where id = current_setting('t.a')::uuid;
set local session_replication_role = origin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select lives_ok($$ select public.create_ticket('30000000-0000-0000-0000-000000000001', 'clean', 0, 0) $$,
  'after the cooldown it can start again');
reset role;
do $$ begin perform set_config('t.b', (select id::text from public.tickets where voided_at is null), false); end $$;

-- window: a job older than a minute cannot be halted
set local session_replication_role = replica; -- the lock trigger forbids moving a start time
update public.tickets set started_at = now() - interval '90 seconds' where id = current_setting('t.b')::uuid;
set local session_replication_role = origin;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000f2","role":"authenticated"}';
select throws_ok(format($$ select public.halt_ticket(%L, 'machine_error', null) $$, current_setting('t.b')),
  'P0001', 'the halt window has passed; this needs a void with admin approval', 'no halt after the window');
select throws_ok(format($$ select public.void_ticket(%L, 'x') $$, current_setting('t.b')),
  'P0001', 'only an admin can void a ticket', 'staff still cannot void directly');
reset role;

set local role anon;
select throws_ok($$ select public.halt_ticket(gen_random_uuid(), 'machine_error', null) $$, '42501', null, 'signed-out callers cannot halt');
reset role;

select * from finish();
rollback;
