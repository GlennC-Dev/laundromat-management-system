begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'attendant@shop.test'),
  ('00000000-0000-0000-0000-0000000000e3', 'former@shop.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1';
update public.profiles set active = false where id = '00000000-0000-0000-0000-0000000000e3';

insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('20000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44),
  ('20000000-0000-0000-0000-000000000002', 'W2', 'wash', 8, 0.56, null, 44);
insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from) values
  ('service', null, 'wash', 8, 'clean', 80, 30, '2025-01-01'),
  ('item', 'detergent', null, null, null, 15, null, '2025-01-01');
insert into public.restocks (item, doses, unit_cost, created_by) values
  ('detergent', 10, 6, '00000000-0000-0000-0000-0000000000e1');

-- staff rings up one ticket and completes it, then another is left open and moved to last week
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok($$ select public.create_ticket('20000000-0000-0000-0000-000000000001', 'clean', 0, 0) $$, 'staff starts a ticket');
select lives_ok($$ select public.create_ticket('20000000-0000-0000-0000-000000000002', 'clean', 0, 0) $$, 'staff starts a second ticket');
reset role;
update public.tickets set started_at = now() - interval '7 days'
  where machine_id = '20000000-0000-0000-0000-000000000002';
do $$ begin perform set_config('t.w1', (select id::text from public.tickets where machine_id = '20000000-0000-0000-0000-000000000001'), false); end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select lives_ok(format($$ select public.complete_ticket(%L, 80, 'cash', null) $$, current_setting('t.w1')), 'staff completes it');
select is((select count(*) from public.tickets where id = current_setting('t.w1')::uuid), 0::bigint,
  'staff cannot read the completed ticket directly');
select is((select count(*) from public.todays_tickets()), 1::bigint,
  'staff see today''s completed ticket through todays_tickets, and not last week''s');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}';
select is((select count(*) from public.todays_tickets()), 0::bigint, 'a deactivated user sees nothing');
reset role;

set local role anon;
select throws_ok($$ select * from public.todays_tickets() $$, '42501', null, 'signed-out callers cannot call it');
reset role;

select * from finish();
rollback;
