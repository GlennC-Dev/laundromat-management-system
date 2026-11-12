begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'attendant@shop.test');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000c1';
insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle)
  values ('10000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44);

-- staff cannot restock
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c2","role":"authenticated"}';
select throws_ilike($$ select public.restock('detergent', 10, 6) $$, '%only an admin%', 'staff cannot restock');
reset role;

-- signed out cannot restock
set local role anon;
select throws_ilike($$ select public.restock('detergent', 10, 6) $$, '%permission denied%', 'signed-out visitors cannot restock');
reset role;

-- admin can restock, and stock reflects it
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000c1","role":"authenticated"}';
select lives_ok($$ select public.restock('detergent', 10, 6) $$, 'admin can restock');
select is((select doses from public.stock_levels() where item = 'detergent'), 10, 'stock reflects the restock');
select throws_ilike($$ select public.restock('fabcon', 0, 4) $$, '%restocks_doses_check%', 'a restock needs at least one dose');
select lives_ok($$ update public.machines set label = 'W1-renamed' where id = '10000000-0000-0000-0000-000000000001' $$,
  'admin can edit a machine');
reset role;

-- audit trail
select is((select count(*)::int from public.audit_log where table_name = 'restocks' and action = 'insert'
           and actor = '00000000-0000-0000-0000-0000000000c1'), 1, 'the restock is audited with the actor');
select is((select after ->> 'label' from public.audit_log where table_name = 'machines' and action = 'update'
           and actor = '00000000-0000-0000-0000-0000000000c1'), 'W1-renamed', 'a machine edit is audited with its new values');
select is((select before ->> 'label' from public.audit_log where table_name = 'machines' and action = 'update'
           and actor = '00000000-0000-0000-0000-0000000000c1'), 'W1', 'and its old values');
select is((select count(*)::int from public.audit_log where table_name = 'profiles' and action = 'insert'), 2,
          'new profiles are audited');

select * from finish();
rollback;
