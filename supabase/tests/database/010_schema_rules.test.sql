begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

-- fixtures --------------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),
  ('00000000-0000-0000-0000-0000000000a2');
-- the signup trigger has already created both profiles as staff
update public.profiles set display_name = 'Admin', role = 'admin' where id = '00000000-0000-0000-0000-0000000000a1';
update public.profiles set display_name = 'Attendant' where id = '00000000-0000-0000-0000-0000000000a2';
insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('10000000-0000-0000-0000-000000000001', 'W1', 'wash', 8, 0.56, null, 44),
  ('10000000-0000-0000-0000-000000000002', 'D1', 'dry', 12, 0.37, 7.8, null);
insert into public.restocks (item, doses, unit_cost, created_by) values
  ('detergent', 10, 6, '00000000-0000-0000-0000-0000000000a1');
insert into public.audit_log (table_name, row_id, action) values ('tickets', 'x', 'insert');

-- structure -------------------------------------------------------------------
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity), 8,
          'all eight tables have row-level security on');
select throws_ilike($$ insert into public.settings (id) values (false) $$, '%violates check constraint%',
          'settings holds a single row');
select throws_ilike($$ insert into public.machines (label, type, capacity_kg, motor_kw) values ('D9','dry',12,0.37) $$,
          '%machines_type_specs%', 'a dryer needs a heating element');
select throws_ilike($$ insert into public.price_list (kind, machine_type, size_kg, level, price, default_minutes, effective_from)
          values ('service','wash',8,'driest',80,30,'2026-01-01') $$,
          '%price_list_shape%', 'a wash price cannot use a dryer level');

-- ticket creation -------------------------------------------------------------
select lives_ok($$ insert into public.tickets (id, kind, machine_id, level, started_at, base_minutes, service_price, created_by)
          values ('20000000-0000-0000-0000-000000000001','machine','10000000-0000-0000-0000-000000000001','clean',
                  '2026-11-12 08:00+08', 30, 80, '00000000-0000-0000-0000-0000000000a2') $$,
          'a pending wash ticket can be created');
select is((select ends_at from public.tickets where id = '20000000-0000-0000-0000-000000000001'),
          '2026-11-12 08:30+08'::timestamptz, 'scheduled end is start plus minutes');
select throws_ilike($$ insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, created_by)
          values ('machine','10000000-0000-0000-0000-000000000001','clean','2026-11-12 08:10+08', 30, 80,
                  '00000000-0000-0000-0000-0000000000a2') $$,
          '%tickets_no_overlapping_runs%', 'overlapping runs on one machine are rejected');
select lives_ok($$ insert into public.tickets (id, kind, machine_id, level, started_at, base_minutes, service_price, created_by)
          values ('20000000-0000-0000-0000-000000000002','machine','10000000-0000-0000-0000-000000000001','clean',
                  '2026-11-12 08:40+08', 30, 80, '00000000-0000-0000-0000-0000000000a2') $$,
          'a run may start after the previous one ends');
select throws_ilike($$ insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, created_by)
          values ('machine','10000000-0000-0000-0000-000000000002','clean','2026-11-12 08:00+08', 30, 80,
                  '00000000-0000-0000-0000-0000000000a2') $$,
          '%does not match%', 'a washer level on a dryer is rejected');
select throws_ilike($$ insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, created_by)
          values ('machine',null,'clean','2026-11-12 08:00+08', 30, 80, '00000000-0000-0000-0000-0000000000a2') $$,
          '%tickets_shape%', 'a machine ticket needs a machine');

-- add-ons, totals and the pending rules ----------------------------------------
select lives_ok($$ update public.tickets set extra_spin_count = 2, spin_unit_price = 15
          where id = '20000000-0000-0000-0000-000000000001' $$,
          'a pending ticket can gain extra spins');
select is((select total from public.tickets where id = '20000000-0000-0000-0000-000000000001'),
          110.00::numeric, 'total is service plus add-ons from the snapshots');
select is((select ends_at from public.tickets where id = '20000000-0000-0000-0000-000000000001'),
          '2026-11-12 08:40+08'::timestamptz, 'extra spins extend the scheduled end, up to the next run exactly');
select throws_ilike($$ update public.tickets set extra_spin_count = 3
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%tickets_no_overlapping_runs%', 'an extension past the next run start is rejected');
select throws_ilike($$ update public.tickets set extra_spin_count = 1
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%only gain add-ons%', 'add-ons cannot be reduced on a pending ticket');
select throws_ilike($$ update public.tickets set machine_id = '10000000-0000-0000-0000-000000000002'
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%cannot change%', 'the machine of a pending ticket cannot change');
select throws_ilike($$ update public.tickets set extra_dry_minutes = 5
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%dryers only%', 'dry minutes cannot be added to a washer ticket');

-- stock -------------------------------------------------------------------------
select throws_ilike($$ update public.tickets set detergent_qty = 11, detergent_unit_price = 15
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%out of stock: detergent%', 'selling more than the stock is rejected');
select lives_ok($$ update public.tickets set detergent_qty = 10, detergent_unit_price = 15
          where id = '20000000-0000-0000-0000-000000000001' $$,
          'selling exactly the stock is allowed');
select is(public.stock_balance('detergent'), 0, 'stock balance is restocks minus sales');

-- completion --------------------------------------------------------------------
select throws_ilike($$ update public.tickets set status = 'completed', completed_at = '2026-11-12 09:00+08',
          completed_by = '00000000-0000-0000-0000-0000000000a2', amount_paid = 260, payment_method = 'gcash'
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%tickets_completion%', 'a non-cash completion needs a reference number');
select lives_ok($$ update public.tickets set status = 'completed', completed_at = '2026-11-12 09:00+08',
          completed_by = '00000000-0000-0000-0000-0000000000a2', amount_paid = 260, payment_method = 'cash'
          where id = '20000000-0000-0000-0000-000000000001' $$,
          'a cash completion needs no reference');
select throws_ilike($$ update public.tickets set extra_spin_count = 3
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%completed tickets are locked%', 'a completed ticket cannot be edited');
select throws_ilike($$ update public.tickets set amount_paid = 1
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%completed tickets are locked%', 'payment on a completed ticket cannot be edited');

-- void --------------------------------------------------------------------------
select throws_ilike($$ update public.tickets set voided_at = '2026-11-12 10:00+08',
          voided_by = '00000000-0000-0000-0000-0000000000a1'
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%tickets_void%', 'a void needs a reason');
select throws_ilike($$ update public.tickets set voided_at = '2026-11-12 10:00+08', void_reason = 'typo',
          voided_by = '00000000-0000-0000-0000-0000000000a1', amount_paid = 5
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%void cannot change any other field%', 'a void cannot change anything else');
select lives_ok($$ update public.tickets set voided_at = '2026-11-12 10:00+08', void_reason = 'wrong machine',
          voided_by = '00000000-0000-0000-0000-0000000000a1'
          where id = '20000000-0000-0000-0000-000000000001' $$,
          'a completed ticket can be voided with a reason');
select is(public.stock_balance('detergent'), 10, 'a void returns its doses to stock');
select throws_ilike($$ update public.tickets set void_reason = 'edited'
          where id = '20000000-0000-0000-0000-000000000001' $$,
          '%voided tickets are locked%', 'a voided ticket is locked');

-- counter sales and append-only tables --------------------------------------------
select throws_ilike($$ insert into public.tickets (kind, detergent_qty, detergent_unit_price, created_by)
          values ('counter', 1, 15, '00000000-0000-0000-0000-0000000000a2') $$,
          '%tickets_shape%', 'a counter sale must be created completed');
select lives_ok($$ insert into public.tickets (kind, started_at, detergent_qty, detergent_unit_price, status,
          completed_at, completed_by, amount_paid, payment_method, created_by)
          values ('counter', '2026-11-12 11:00+08', 2, 15, 'completed', '2026-11-12 11:00+08',
          '00000000-0000-0000-0000-0000000000a2', 30, 'cash', '00000000-0000-0000-0000-0000000000a2') $$,
          'a counter sale can be created and completed in one step');
select throws_ilike($$ delete from public.tickets $$, '%cannot be deleted%', 'tickets cannot be deleted');
select throws_ilike($$ update public.restocks set doses = 99 $$, '%append-only%', 'restocks are append-only');
select throws_ilike($$ delete from public.audit_log $$, '%append-only%', 'the audit log is append-only');

select * from finish();
rollback;
