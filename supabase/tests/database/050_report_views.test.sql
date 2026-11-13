begin;
create extension if not exists pgtap with schema extensions;
select plan(47);

-- Hand-built dataset. Shop timezone Asia/Manila, hours 08:00-21:00 (13 open hours), load factor 0.7,
-- dryer duty 0.6, water factors 1.0, electricity 10 per kWh, water 50 per m3 from 2026-01-01.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'boss@shop.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'attendant@shop.test');
update public.profiles set role = 'admin', display_name = 'Boss' where id = '00000000-0000-0000-0000-0000000000e1';

insert into public.machines (id, label, type, capacity_kg, motor_kw, element_kw, water_l_per_cycle) values
  ('10000000-0000-0000-0000-000000000001', 'W1', 'wash', 8,  0.5, null, 40),
  ('10000000-0000-0000-0000-000000000002', 'D1', 'dry',  12, 0.4, 5,    null),
  ('10000000-0000-0000-0000-000000000003', 'W2', 'wash', 8,  0.5, null, 40);
insert into public.utility_rates (kind, rate, effective_from) values
  ('electricity', 10, '2026-01-01'), ('water', 50, '2026-01-01');
insert into public.restocks (item, doses, unit_cost, restocked_at, created_by) values
  ('detergent', 10, 6, '2026-11-01 10:00+08', '00000000-0000-0000-0000-0000000000e1'),
  ('detergent', 10, 8, '2026-11-09 10:00+08', '00000000-0000-0000-0000-0000000000e1'),
  ('fabcon',     5, 4, '2026-11-01 10:00+08', '00000000-0000-0000-0000-0000000000e1');

-- 2026-11-10 -------------------------------------------------------------------------------
-- T1 wash clean 30 min, 80 + 2 detergent at 15 = 110, paid cash 110
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, detergent_qty, detergent_unit_price,
  status, completed_at, completed_by, amount_paid, payment_method, created_by) values
 ('machine','10000000-0000-0000-0000-000000000001','clean','2026-11-10 08:00+08',30,80,2,15,
  'completed','2026-11-10 09:00+08','00000000-0000-0000-0000-0000000000e2',110,'cash','00000000-0000-0000-0000-0000000000e2');
-- T2 dry 40 min + 10 extra (2 steps at 10), 60 -> 80, paid gcash ref GC-1
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, extra_dry_minutes, dry_ext_unit_price,
  status, completed_at, completed_by, amount_paid, payment_method, reference_no, created_by) values
 ('machine','10000000-0000-0000-0000-000000000002','dry','2026-11-10 09:00+08',40,60,10,10,
  'completed','2026-11-10 10:00+08','00000000-0000-0000-0000-0000000000e2',80,'gcash','GC-1','00000000-0000-0000-0000-0000000000e2');
-- T3 wash cleaner 40 min + 1 spin (15, 5 min), 100 -> 115, paid 100 (a mismatch)
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, extra_spin_count, spin_unit_price,
  status, completed_at, completed_by, amount_paid, payment_method, created_by) values
 ('machine','10000000-0000-0000-0000-000000000001','cleaner','2026-11-10 10:00+08',40,100,1,15,
  'completed','2026-11-10 11:00+08','00000000-0000-0000-0000-0000000000e2',100,'cash','00000000-0000-0000-0000-0000000000e2');
-- counter sale: 2 fabcon at 10 = 20
insert into public.tickets (kind, started_at, fabcon_qty, fabcon_unit_price, status, completed_at, completed_by, amount_paid,
  payment_method, created_by) values
 ('counter','2026-11-10 12:00+08',2,10,'completed','2026-11-10 12:00+08','00000000-0000-0000-0000-0000000000e2',20,'cash',
  '00000000-0000-0000-0000-0000000000e2');
-- T4 dry 40 min started 20:30, still pending (60)
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price, created_by) values
 ('machine','10000000-0000-0000-0000-000000000002','dry','2026-11-10 20:30+08',40,60,'00000000-0000-0000-0000-0000000000e2');
-- T6 voided ticket (must vanish from every number)
insert into public.tickets (id, kind, machine_id, level, started_at, base_minutes, service_price, created_by) values
 ('30000000-0000-0000-0000-000000000006','machine','10000000-0000-0000-0000-000000000003','clean','2026-11-10 13:00+08',30,80,
  '00000000-0000-0000-0000-0000000000e2');
update public.tickets set voided_at = '2026-11-10 13:05+08', void_reason = 'wrong machine',
  voided_by = '00000000-0000-0000-0000-0000000000e1' where id = '30000000-0000-0000-0000-000000000006';

-- 2026-11-09: T7 wash 30 min, 80, paid gcash with the same reference GC-1
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price,
  status, completed_at, completed_by, amount_paid, payment_method, reference_no, created_by) values
 ('machine','10000000-0000-0000-0000-000000000001','clean','2026-11-09 08:00+08',30,80,
  'completed','2026-11-09 09:00+08','00000000-0000-0000-0000-0000000000e2',80,'gcash','GC-1','00000000-0000-0000-0000-0000000000e2');

-- 11-11 start, 11-12 completion: T5 wash 30 min started 20:50, paid next morning
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price,
  status, completed_at, completed_by, amount_paid, payment_method, created_by) values
 ('machine','10000000-0000-0000-0000-000000000001','clean','2026-11-11 20:50+08',30,80,
  'completed','2026-11-12 09:00+08','00000000-0000-0000-0000-0000000000e2',80,'cash','00000000-0000-0000-0000-0000000000e2');

-- 2025-12-15 before any utility rate exists: T0 wash 30 min on W2, 80
insert into public.tickets (kind, machine_id, level, started_at, base_minutes, service_price,
  status, completed_at, completed_by, amount_paid, payment_method, created_by) values
 ('machine','10000000-0000-0000-0000-000000000003','clean','2025-12-15 08:00+08',30,80,
  'completed','2025-12-15 09:00+08','00000000-0000-0000-0000-0000000000e2',80,'cash','00000000-0000-0000-0000-0000000000e2');

-- as admin: the numbers calculated by hand ---------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}';

-- jobs and hours, by start date (T6 void excluded)
select is((select wash_jobs from public.mart_eod where business_date = '2026-11-10'), 2::bigint, '11-10 wash jobs');
select is((select dry_jobs from public.mart_eod where business_date = '2026-11-10'), 2::bigint, '11-10 dry jobs');
select is((select counter_sales from public.mart_eod where business_date = '2026-11-10'), 1::bigint, '11-10 counter sales are counted separately');
select is((select round(machine_hours, 4) from public.mart_eod where business_date = '2026-11-10'), 2.7500::numeric,
  '11-10 machine hours = 0.5 + 0.8333 + 0.75 + 0.6667');
select is((select round(fleet_utilization, 4) from public.mart_eod where business_date = '2026-11-10'), round(2.75 / 39, 4),
  '11-10 utilization = hours / (13 open hours x 3 machines)');

-- utilities
select is((select round(kwh_est, 4) from public.mart_eod where business_date = '2026-11-10'), 5.5375::numeric,
  '11-10 kWh = 0.175 + 2.8333 + 0.2625 + 2.2667');
select is((select litres_est from public.mart_eod where business_date = '2026-11-10'), 80::numeric, '11-10 litres: dryers use none');
select is((select round(utility_cost_est, 3) from public.mart_eod where business_date = '2026-11-10'), 59.375::numeric,
  '11-10 utility cost = 5.5375 x 10 + 80 L x 50 per m3');

-- revenue, by completion date
select is((select gross_revenue from public.mart_eod where business_date = '2026-11-10'), 325::numeric, '11-10 gross = 110 + 80 + 115 + 20');
select is((select service_revenue from public.mart_eod where business_date = '2026-11-10'), 275::numeric, '11-10 service revenue');
select is((select item_revenue from public.mart_eod where business_date = '2026-11-10'), 50::numeric, '11-10 item revenue = 30 detergent + 20 fabcon');
select is((select cash from public.mart_eod where business_date = '2026-11-10'), 245::numeric, '11-10 cash = 110 + 115 + 20');
select is((select gcash from public.mart_eod where business_date = '2026-11-10'), 80::numeric, '11-10 gcash');
select is((select payment_variance from public.mart_eod where business_date = '2026-11-10'), -15::numeric, '11-10 collected is 15 short');

-- supplies and margin
select is((select supplies_cost from public.mart_eod where business_date = '2026-11-10'), 22::numeric,
  '11-10 supplies = 2 x average 7 + 2 x 4');
select is((select round(operating_expenses, 3) from public.mart_eod where business_date = '2026-11-10'), 81.375::numeric, '11-10 operating expenses');
select is((select round(operating_margin, 3) from public.mart_eod where business_date = '2026-11-10'), 243.625::numeric, '11-10 operating margin');
select is((select round(operating_margin_pct, 4) from public.mart_eod where business_date = '2026-11-10'), round(243.625 / 325, 4), '11-10 margin percentage');

-- pending at close
select is((select pending_at_close_count from public.mart_eod where business_date = '2026-11-10'), 1::bigint, '11-10 one ticket unpaid at close');
select is((select pending_at_close_value from public.mart_eod where business_date = '2026-11-10'), 60::numeric, '11-10 unpaid value');

-- the earlier day: average cost to date includes only restocks up to that day
select is((select gross_revenue from public.mart_eod where business_date = '2026-11-09'), 80::numeric, '11-09 gross');
select is((select round(operating_margin, 3) from public.mart_eod where business_date = '2026-11-09'), 76.25::numeric, '11-09 margin = 80 - 3.75 utilities');

-- start date versus completion date
select is((select machine_jobs from public.mart_eod where business_date = '2026-11-11'), 1::bigint, '11-11 has the job (start date)');
select is((select gross_revenue from public.mart_eod where business_date = '2026-11-11'), 0::numeric, '11-11 has no revenue yet');
select is((select pending_at_close_count from public.mart_eod where business_date = '2026-11-11'), 1::bigint, '11-11 job paid after close counts as pending at close');
select is((select gross_revenue from public.mart_eod where business_date = '2026-11-12'), 80::numeric, '11-12 has the revenue (completion date)');
select is((select machine_jobs from public.mart_eod where business_date = '2026-11-12'), 0::bigint, '11-12 has no jobs');

-- missing utility rate
select is((select runs_missing_rates from public.mart_eod where business_date = '2025-12-15'), 1::bigint, 'a run before any rate is flagged');
select is((select utility_cost_est from public.mart_eod where business_date = '2025-12-15'), null, 'its utility cost stays null, never zero');

-- per machine
select is((select jobs from public.mart_machine_daily where machine_label = 'W1' and business_date = '2026-11-10'), 2::bigint, 'W1 ran twice on 11-10');
select is((select round(utilization, 4) from public.mart_machine_daily where machine_label = 'D1' and business_date = '2026-11-10'),
  round((50 + 40) / 60.0 / 13, 4), 'D1 utilization on 11-10');

-- data quality
select is((select count(*)::int from public.dq_payment_mismatch), 1, 'one payment differs from its total');
select is((select difference from public.dq_payment_mismatch), -15::numeric, 'by 15 short');
select is((select count(*)::int from public.dq_repeated_references where times_used = 2), 2, 'both uses of the repeated reference are listed');
select is((select void_reason from public.dq_voids), 'wrong machine', 'the void is listed with its reason');
select is((select voided_by_name from public.dq_voids), 'Boss', 'and who voided it');
select is((select count(*)::int from public.dq_stale_pending), 1, 'the old unpaid ticket is flagged');
select is((select count(*)::int from public.dq_idle_machines), 7, 'idle machine-days: 2 + 2 + 1 + 2');
select is((select count(*)::int from public.dq_idle_machines where machine_label = 'W2' and business_date = '2026-11-10'), 1,
  'W2 is idle on 11-10 because its only ticket was voided');
select is((select count(*)::int from public.dq_missing_rates), 1, 'one run lacks a utility rate');
select is((select count(*)::int from public.dq_issues where issue = 'void'), 1, 'the combined list includes the void');
select is((select count(distinct issue)::int from public.dq_issues), 6, 'the combined list covers all six checks');
select is((select count(*)::int from public.stg_tickets where ticket_id = '30000000-0000-0000-0000-000000000006'), 0, 'the voided ticket is not in staging');
reset role;

-- as staff: no report ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}';
select is((select count(*)::int from public.mart_eod), 0, 'staff see no end-of-day rows');
select is((select count(*)::int from public.stg_tickets), 0, 'staff see no staging rows');
select is((select count(*)::int from public.dq_issues), 0, 'staff see no data-quality issues');
reset role;

-- signed out ------------------------------------------------------------------------------------
set local role anon;
select throws_ilike($$ select * from public.mart_eod $$, '%permission denied%', 'signed-out visitors cannot read the report');
reset role;

select * from finish();
rollback;
