-- Stage 5: staging views, daily marts and data-quality checks.
-- All views run with the caller's rights (security_invoker) and also return nothing unless the
-- caller is an admin, so staff cannot read any report. Voided tickets are excluded everywhere
-- except dq_voids. Business dates use the shop timezone from settings.

-- Staging: one row per non-voided ticket --------------------------------------------------
create view public.stg_tickets with (security_invoker = on) as
select
  t.id as ticket_id,
  t.kind,
  t.status,
  t.machine_id,
  t.level,
  t.started_at,
  t.completed_at,
  (t.started_at   at time zone s.timezone)::date as start_date,
  (t.completed_at at time zone s.timezone)::date as completion_date,
  t.base_minutes,
  t.extra_dry_minutes,
  t.extra_spin_count,
  t.spin_minutes,
  t.detergent_qty,
  t.fabcon_qty,
  coalesce(t.service_price, 0)                          as base_revenue,
  (t.extra_dry_minutes / 5) * t.dry_ext_unit_price      as extra_dry_revenue,
  t.extra_spin_count * t.spin_unit_price                as extra_spin_revenue,
  t.detergent_qty * t.detergent_unit_price              as detergent_revenue,
  t.fabcon_qty * t.fabcon_unit_price                    as fabcon_revenue,
  coalesce(t.service_price, 0)
    + (t.extra_dry_minutes / 5) * t.dry_ext_unit_price
    + t.extra_spin_count * t.spin_unit_price            as service_revenue,
  t.detergent_qty * t.detergent_unit_price
    + t.fabcon_qty * t.fabcon_unit_price                as item_revenue,
  t.total,
  t.amount_paid,
  t.payment_method,
  t.reference_no,
  t.created_by,
  t.completed_by
from public.tickets t
cross join public.settings s
where t.voided_at is null
  and (select public.app_role()) = 'admin';

-- Staging: one row per machine run, with scheduled hours and estimated utilities ------------
create view public.stg_machine_runs with (security_invoker = on) as
select
  t.ticket_id,
  t.machine_id,
  m.label as machine_label,
  m.type as machine_type,
  m.capacity_kg,
  t.level,
  t.status,
  t.start_date,
  t.base_minutes,
  t.extra_dry_minutes,
  t.extra_spin_count * t.spin_minutes as extra_spin_minutes,
  t.base_minutes + t.extra_dry_minutes + t.extra_spin_count * t.spin_minutes as run_minutes,
  (t.base_minutes + t.extra_dry_minutes + t.extra_spin_count * t.spin_minutes) / 60.0 as run_hours,
  e.kwh,
  w.litres,
  er.rate as electricity_rate,
  wr.rate as water_rate,
  e.kwh * er.rate as electricity_cost,
  case when w.litres = 0 then 0 else w.litres / 1000.0 * wr.rate end as water_cost,
  e.kwh * er.rate + case when w.litres = 0 then 0 else w.litres / 1000.0 * wr.rate end as utility_cost
from public.stg_tickets t
join public.machines m on m.id = t.machine_id
cross join public.settings s
cross join lateral (
  select case m.type
    when 'wash' then m.motor_kw * s.washer_load_factor
    else m.element_kw * (case t.level when 'dry' then s.dryer_duty_dry when 'drier' then s.dryer_duty_drier
                                      else s.dryer_duty_driest end) + m.motor_kw
  end * ((t.base_minutes + t.extra_dry_minutes + t.extra_spin_count * t.spin_minutes) / 60.0) as kwh
) e
cross join lateral (
  select case when m.type = 'wash'
    then m.water_l_per_cycle * (case t.level when 'clean' then s.water_factor_clean
                                             when 'cleaner' then s.water_factor_cleaner
                                             else s.water_factor_cleanest end)
    else 0 end as litres
) w
left join lateral (
  select rate from public.utility_rates
  where kind = 'electricity' and effective_from <= t.start_date order by effective_from desc limit 1
) er on true
left join lateral (
  select rate from public.utility_rates
  where kind = 'water' and effective_from <= t.start_date order by effective_from desc limit 1
) wr on true
where t.kind = 'machine';

-- Mart: per machine per start date ---------------------------------------------------------
create view public.mart_machine_daily with (security_invoker = on) as
select
  r.machine_id,
  r.machine_label,
  r.machine_type,
  r.start_date as business_date,
  count(*) as jobs,
  sum(r.run_hours) as machine_hours,
  sum(r.run_hours) / nullif(extract(epoch from (s.closing_time - s.opening_time)) / 3600.0, 0) as utilization
from public.stg_machine_runs r
cross join public.settings s
group by r.machine_id, r.machine_label, r.machine_type, r.start_date, s.closing_time, s.opening_time;

-- Mart: operations by start date -----------------------------------------------------------
create view public.mart_daily_ops with (security_invoker = on) as
with open_hours as (
  select extract(epoch from (closing_time - opening_time)) / 3600.0 as hours from public.settings
),
pending_close as (
  select t.start_date, count(*) as cnt, sum(t.total) as val
  from public.stg_tickets t
  cross join public.settings s
  where t.kind = 'machine'
    and (t.status = 'pending'
         or t.completed_at > ((t.start_date + s.closing_time) at time zone s.timezone))
  group by t.start_date
)
select
  r.start_date as business_date,
  count(*) filter (where r.machine_type = 'wash') as wash_jobs,
  count(*) filter (where r.machine_type = 'dry')  as dry_jobs,
  count(*) as machine_jobs,
  sum(r.run_hours) as machine_hours,
  sum(r.run_hours) / nullif((select hours from open_hours) * (select count(*) from public.machines where active), 0) as fleet_utilization,
  sum(r.kwh) as kwh_est,
  sum(r.litres) as litres_est,
  sum(r.electricity_cost) as electricity_cost_est,
  sum(r.water_cost) as water_cost_est,
  sum(r.utility_cost) as utility_cost_est,
  count(*) filter (where r.utility_cost is null) as runs_missing_rates,
  coalesce(max(pc.cnt), 0) as pending_at_close_count,
  coalesce(max(pc.val), 0) as pending_at_close_value
from public.stg_machine_runs r
left join pending_close pc on pc.start_date = r.start_date
group by r.start_date;

-- Mart: money by completion date -----------------------------------------------------------
create view public.mart_daily_finance with (security_invoker = on) as
with daily as (
  select
    t.completion_date as business_date,
    count(*) filter (where t.kind = 'counter') as counter_sales,
    sum(t.total) as gross_revenue,
    sum(t.service_revenue) as service_revenue,
    sum(t.item_revenue) as item_revenue,
    sum(t.total) filter (where t.payment_method = 'cash')          as cash,
    sum(t.total) filter (where t.payment_method = 'gcash')         as gcash,
    sum(t.total) filter (where t.payment_method = 'maya')          as maya,
    sum(t.total) filter (where t.payment_method = 'bank_transfer') as bank_transfer,
    sum(t.total) filter (where t.payment_method = 'card')          as card,
    sum(t.amount_paid) as collected,
    sum(t.detergent_qty) as detergent_units,
    sum(t.fabcon_qty) as fabcon_units
  from public.stg_tickets t
  where t.status = 'completed'
  group by t.completion_date
)
select
  d.business_date,
  d.counter_sales,
  d.gross_revenue,
  d.service_revenue,
  d.item_revenue,
  coalesce(d.cash, 0) as cash,
  coalesce(d.gcash, 0) as gcash,
  coalesce(d.maya, 0) as maya,
  coalesce(d.bank_transfer, 0) as bank_transfer,
  coalesce(d.card, 0) as card,
  d.collected,
  d.collected - d.gross_revenue as payment_variance,
  d.detergent_units,
  d.fabcon_units,
  d.detergent_units * coalesce(da.avg_cost, 0) + d.fabcon_units * coalesce(fa.avg_cost, 0) as supplies_cost
from daily d
cross join public.settings s
left join lateral (
  select sum(doses * unit_cost) / nullif(sum(doses), 0) as avg_cost from public.restocks
  where item = 'detergent' and (restocked_at at time zone s.timezone)::date <= d.business_date
) da on true
left join lateral (
  select sum(doses * unit_cost) / nullif(sum(doses), 0) as avg_cost from public.restocks
  where item = 'fabcon' and (restocked_at at time zone s.timezone)::date <= d.business_date
) fa on true;

-- Mart: the end-of-day report, one row per business date -----------------------------------
create view public.mart_eod with (security_invoker = on) as
select
  coalesce(o.business_date, f.business_date) as business_date,
  coalesce(o.wash_jobs, 0) as wash_jobs,
  coalesce(o.dry_jobs, 0) as dry_jobs,
  coalesce(o.machine_jobs, 0) as machine_jobs,
  coalesce(f.counter_sales, 0) as counter_sales,
  coalesce(o.machine_hours, 0) as machine_hours,
  coalesce(o.fleet_utilization, 0) as fleet_utilization,
  coalesce(o.kwh_est, 0) as kwh_est,
  coalesce(o.litres_est, 0) as litres_est,
  o.utility_cost_est,
  coalesce(o.runs_missing_rates, 0) as runs_missing_rates,
  coalesce(o.pending_at_close_count, 0) as pending_at_close_count,
  coalesce(o.pending_at_close_value, 0) as pending_at_close_value,
  coalesce(f.gross_revenue, 0) as gross_revenue,
  coalesce(f.service_revenue, 0) as service_revenue,
  coalesce(f.item_revenue, 0) as item_revenue,
  coalesce(f.cash, 0) as cash,
  coalesce(f.gcash, 0) as gcash,
  coalesce(f.maya, 0) as maya,
  coalesce(f.bank_transfer, 0) as bank_transfer,
  coalesce(f.card, 0) as card,
  coalesce(f.collected, 0) as collected,
  coalesce(f.payment_variance, 0) as payment_variance,
  coalesce(f.supplies_cost, 0) as supplies_cost,
  coalesce(o.utility_cost_est, 0) + coalesce(f.supplies_cost, 0) as operating_expenses,
  coalesce(f.gross_revenue, 0) - coalesce(o.utility_cost_est, 0) - coalesce(f.supplies_cost, 0) as operating_margin,
  (coalesce(f.gross_revenue, 0) - coalesce(o.utility_cost_est, 0) - coalesce(f.supplies_cost, 0))
    / nullif(f.gross_revenue, 0) as operating_margin_pct
from public.mart_daily_ops o
full join public.mart_daily_finance f on f.business_date = o.business_date;

-- Data-quality checks -----------------------------------------------------------------------
create view public.dq_payment_mismatch with (security_invoker = on) as
select ticket_id, completion_date as business_date, total, amount_paid, amount_paid - total as difference
from public.stg_tickets
where status = 'completed' and amount_paid is distinct from total;

create view public.dq_repeated_references with (security_invoker = on) as
select ticket_id, completion_date as business_date, payment_method, reference_no,
       count(*) over (partition by payment_method, reference_no) as times_used
from public.stg_tickets
where status = 'completed' and reference_no is not null;

create view public.dq_voids with (security_invoker = on) as
select t.id as ticket_id,
       (t.voided_at at time zone s.timezone)::date as business_date,
       t.total, t.void_reason, t.voided_at, p.display_name as voided_by_name
from public.tickets t
cross join public.settings s
left join public.profiles p on p.id = t.voided_by
where t.voided_at is not null and (select public.app_role()) = 'admin';

create view public.dq_stale_pending with (security_invoker = on) as
select ticket_id, start_date as business_date, machine_id, started_at, total
from public.stg_tickets
where status = 'pending' and started_at < now() - interval '1 day';

create view public.dq_idle_machines with (security_invoker = on) as
select d.business_date, m.id as machine_id, m.label as machine_label
from (select business_date from public.mart_daily_ops) d
cross join public.machines m
where m.active
  and (select public.app_role()) = 'admin'
  and not exists (
    select 1 from public.stg_machine_runs r where r.machine_id = m.id and r.start_date = d.business_date
  );

create view public.dq_missing_rates with (security_invoker = on) as
select ticket_id, start_date as business_date, machine_id
from public.stg_machine_runs
where utility_cost is null;

-- One list for the data-quality panel.
create view public.dq_issues with (security_invoker = on) as
select 'payment_mismatch' as issue, business_date, ticket_id, null::uuid as machine_id,
       'Paid ' || amount_paid || ' against a total of ' || total as detail, difference as amount
from public.dq_payment_mismatch
union all
select 'repeated_reference', business_date, ticket_id, null,
       payment_method || ' reference ' || reference_no || ' used ' || times_used || ' times', null
from public.dq_repeated_references where times_used > 1
union all
select 'void', business_date, ticket_id, null, void_reason, total from public.dq_voids
union all
select 'stale_pending', business_date, ticket_id, machine_id, 'Still unpaid since ' || started_at::date, total
from public.dq_stale_pending
union all
select 'idle_machine', business_date, null, machine_id, machine_label || ' had no runs', null
from public.dq_idle_machines
union all
select 'missing_rate', business_date, ticket_id, machine_id, 'No utility rate in effect, cost not estimated', null
from public.dq_missing_rates;
