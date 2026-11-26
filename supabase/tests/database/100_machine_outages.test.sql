begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'attendant@shop.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000e1';
insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('40000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44),
  ('40000000-0000-0000-0000-000000000002', 'W2', 'wash', 8, 0.56, null, 44),
  ('40000000-0000-0000-0000-000000000003', 'D1', 'dry', 12, 0.37, 7.8, null);
insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from) values
  ('service', null, 'wash', 8, 'clean', 80, 30, '2025-01-01');
insert into public.utility_rates (kind, rate, effective_from) values ('electricity', 12, '2025-01-01'), ('water', 30, '2025-01-01');

set local role authenticated;

-- staff cannot do either
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ilike($$select public.take_machine_down('40000000-0000-0000-0000-000000000001', 'broken')$$,
  '%only an admin%', 'staff cannot take a machine down');
select throws_ilike($$select public.bring_machine_up('40000000-0000-0000-0000-000000000001')$$,
  '%only an admin%', 'staff cannot bring a machine up');
-- a machine with a job running cannot be taken down
select lives_ok($$select public.create_ticket('40000000-0000-0000-0000-000000000002', 'clean', 0, 0, null, 'Test Customer', '09170000001')$$,
  'staff starts a job on W2');

set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select throws_ilike($$select public.take_machine_down('40000000-0000-0000-0000-000000000002', 'maintenance')$$,
  '%open ticket%', 'a machine with an open ticket cannot be taken down');
select throws_ilike($$select public.take_machine_down('40000000-0000-0000-0000-000000000001', 'other')$$,
  '%describe the problem%', '"other" needs a note');
select lives_ok($$select public.take_machine_down('40000000-0000-0000-0000-000000000001', 'broken', 'Drum will not spin')$$,
  'admin takes a free machine down');
select is((select status::text from public.machines where id = '40000000-0000-0000-0000-000000000001'), 'out_of_service',
  'the machine is out of service');
select is((select reason::text || ' / ' || note from public.machine_outages where machine_id = '40000000-0000-0000-0000-000000000001' and ended_at is null),
  'broken / Drum will not spin', 'the outage records reason and note');
select throws_ilike($$select public.take_machine_down('40000000-0000-0000-0000-000000000001', 'broken')$$,
  '%already out of service%', 'it cannot be taken down twice');

-- no job can start on it, and staff can see why
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select throws_ilike($$select public.create_ticket('40000000-0000-0000-0000-000000000001', 'clean', 0, 0, null, 'Test Customer', '09170000001')$$,
  '%not available%', 'no job starts on a machine that is out of service');
select is((select count(*)::int from public.machine_outages where ended_at is null), 1, 'staff can read the open outage');
select throws_ilike($$insert into public.machine_outages (machine_id, reason) values ('40000000-0000-0000-0000-000000000003', 'broken')$$,
  '%permission denied%', 'staff cannot write outages directly');

-- bringing it back closes the outage
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';
select lives_ok($$select public.bring_machine_up('40000000-0000-0000-0000-000000000001', 'Belt replaced')$$,
  'admin brings it back');
select is((select status::text from public.machines where id = '40000000-0000-0000-0000-000000000001'), 'available',
  'the machine is available again');
select is((select end_note || ' / ' || (ended_by is not null)::text from public.machine_outages where machine_id = '40000000-0000-0000-0000-000000000001'),
  'Belt replaced / true', 'the outage is closed with who and why');
select throws_ilike($$select public.bring_machine_up('40000000-0000-0000-0000-000000000001')$$,
  '%not out of service%', 'a working machine cannot be brought up');

-- the Machines page keeps the history too
update public.machines set status = 'out_of_service' where id = '40000000-0000-0000-0000-000000000003';
select is((select reason::text from public.machine_outages where machine_id = '40000000-0000-0000-0000-000000000003' and ended_at is null),
  'other', 'a status change on the Machines page opens an outage');
update public.machines set status = 'available' where id = '40000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.machine_outages where machine_id = '40000000-0000-0000-0000-000000000003' and ended_at is null),
  0, 'and closes it when the machine is made available');
select is((select count(*)::int from public.audit_log where action in ('take_down', 'bring_up')), 2, 'both actions are in the audit log');

select * from finish();
rollback;
