begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c2', 'attendant@shop.test');
insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('40000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44),
  ('40000000-0000-0000-0000-000000000003', 'D1', 'dry', 12, 0.37, 7.8, null);
insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from) values
  ('service', null, 'wash', 8, 'clean', 80, 30, '2025-01-01'),
  ('service', null, 'dry', 12, 'dry', 60, 40, '2025-01-01'),
  ('item', 'detergent', null, null, null, 20, null, '2025-01-01'),
  ('item', 'fabcon', null, null, null, 20, null, '2025-01-01');
insert into public.utility_rates (kind, rate, effective_from) values ('electricity', 12, '2025-01-01'), ('water', 30, '2025-01-01');
insert into public.restocks (item, doses, unit_cost, created_by) values
  ('detergent', 50, 10, '00000000-0000-0000-0000-0000000000c2'),
  ('fabcon', 50, 10, '00000000-0000-0000-0000-0000000000c2');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';

select throws_ok(
  $$select public.create_ticket('40000000-0000-0000-0000-000000000003', 'dry', 1, 0, null, 'Test Customer', '09170000001')$$,
  'detergent and fabric conditioner apply to washers only', 'a dryer job cannot start with detergent');
select throws_ok(
  $$select public.create_ticket('40000000-0000-0000-0000-000000000003', 'dry', 0, 1, null, 'Test Customer', '09170000001')$$,
  'detergent and fabric conditioner apply to washers only', 'a dryer job cannot start with fabric conditioner');
select lives_ok(
  $$select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 1, 1, null, 'Test Customer', '09170000001')$$,
  'a washer job still takes both');
select lives_ok(
  $$select public.create_ticket('40000000-0000-0000-0000-000000000003', 'dry', 0, 0, null, 'Test Customer', '09170000001')$$,
  'a plain dryer job starts');
select throws_ok(
  $$select public.add_to_ticket((select id from public.tickets where machine_id = '40000000-0000-0000-0000-000000000003'), 0, 0, 1, 0)$$,
  'detergent and fabric conditioner apply to washers only', 'detergent cannot be added to a running dryer job');

select * from finish();
rollback;
