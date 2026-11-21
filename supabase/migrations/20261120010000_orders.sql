-- Orders: one customer visit groups several machine jobs (say two washers and a dryer).
-- A job opens an order (name and phone) or joins one that is still open. Jobs are still paid one at a
-- time, or the whole order can be paid at once. The order closes by itself when its last job is paid
-- or voided. The order number is the opening time as an Excel serial date-time in whole seconds
-- (days since 1899-12-30 times 86,400, Manila time), so it converts back in Excel with /86400.

create type public.order_status as enum ('open', 'closed');

create function public.normalize_phone(p text)
returns text
language sql immutable
set search_path = ''
as $$
  select case when d ~ '^09[0-9]{9}$' then d end
  from (select case
          when c like '+63%' then '0' || substr(c, 4)
          when c ~ '^63[0-9]{10}$' then '0' || substr(c, 3)
          else c end as d
        from (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as c) x) y;
$$;

create table public.orders (
  id            bigint primary key,
  customer_name text not null check (nullif(btrim(customer_name), '') is not null),
  phone         text not null check (phone ~ '^09[0-9]{9}$'),
  status        public.order_status not null default 'open',
  opened_at     timestamptz not null default now(),
  opened_by     uuid not null references public.profiles (id),
  closed_at     timestamptz,
  constraint orders_closed check (
    (status = 'open' and closed_at is null) or (status = 'closed' and closed_at is not null and closed_at >= opened_at)
  )
);
-- The same customer cannot have two open orders at once.
create unique index orders_one_open_per_customer
  on public.orders (lower(btrim(customer_name)), phone) where status = 'open';
create index orders_opened_at on public.orders (opened_at);

create function public.next_order_id(p_at timestamptz)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v bigint := floor(extract(epoch from ((p_at at time zone (select timezone from public.settings)) - timestamp '1899-12-30')))::bigint;
begin
  while exists (select 1 from public.orders where id = v) loop v := v + 1; end loop;
  return v;
end;
$$;

-- Machine jobs always belong to an order; create_ticket is the only way to make them. Counter sales have none.
alter table public.tickets add column order_id bigint references public.orders (id) on delete restrict;
create index tickets_order_id on public.tickets (order_id);

-- Close the order once none of its jobs is still pending.
create function public.tickets_sync_order()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.order_id is null then return new; end if;
  perform 1 from public.orders where id = new.order_id for update; -- serialise concurrent payments
  update public.orders set status = 'closed', closed_at = now()
  where id = new.order_id and status = 'open'
    and not exists (
      select 1 from public.tickets where order_id = new.order_id and status = 'pending' and voided_at is null
    );
  return new;
end;
$$;
create trigger tickets_sync_order after insert or update on public.tickets
  for each row execute function public.tickets_sync_order();

-- create_ticket now takes the customer.
drop function public.create_ticket(uuid, public.service_level, integer, integer);
create function public.create_ticket(
  p_machine_id uuid, p_level public.service_level,
  p_detergent_qty integer default 0, p_fabcon_qty integer default 0,
  p_order_id bigint default null, p_customer_name text default null, p_phone text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m public.machines;
  svc public.price_list;
  spin public.price_list;
  det public.price_list;
  fab public.price_list;
  t public.tickets;
  busy_until timestamptz;
  v_wait integer;
  v_order bigint;
  v_phone text;
  o public.orders;
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;
  if p_detergent_qty < 0 or p_fabcon_qty < 0 then raise exception 'quantities cannot be negative'; end if;

  select * into m from public.machines where id = p_machine_id;
  if not found then raise exception 'unknown machine'; end if;
  if (m.type = 'wash') <> (p_level in ('clean', 'cleaner', 'cleanest')) then
    raise exception 'level % does not match a % machine', p_level, m.type;
  end if;

  select ceil(extract(epoch from (h.voided_at + interval '60 seconds' - now())))::integer
    into v_wait
  from public.tickets h
  where h.machine_id = m.id and h.halt_reason is not null and h.voided_at + interval '60 seconds' > now()
  order by h.voided_at desc limit 1;
  if v_wait is not null then
    raise exception 'machine % was just halted; try again in % seconds', m.label, v_wait;
  end if;

  svc := public.price_in_effect('service', null, m.type, m.capacity_kg, p_level);
  if svc.id is null then
    raise exception 'no price set for % kg % (%)', trim_scale(m.capacity_kg), m.type, p_level;
  end if;
  if m.type = 'wash' then
    spin := public.price_in_effect('add_on', 'extra_spin', 'wash', null, null);
  end if;
  if p_detergent_qty > 0 then
    det := public.price_in_effect('item', 'detergent', null, null, null);
    if det.id is null then raise exception 'no detergent price set'; end if;
  end if;
  if p_fabcon_qty > 0 then
    fab := public.price_in_effect('item', 'fabcon', null, null, null);
    if fab.id is null then raise exception 'no fabric conditioner price set'; end if;
  end if;

  -- Every machine job belongs to an order: an open one picked by id, or the customer's open order
  -- (matched on name and phone), or a new order.
  if p_order_id is not null then
    select * into o from public.orders where id = p_order_id and status = 'open' for update;
    if not found then raise exception 'that order is closed or does not exist'; end if;
    v_order := o.id;
  else
    if nullif(btrim(p_customer_name), '') is null then raise exception 'enter the customer name'; end if;
    v_phone := public.normalize_phone(p_phone);
    if v_phone is null then raise exception 'enter a valid mobile number, like 0917 123 4567'; end if;
    select * into o from public.orders
      where status = 'open' and lower(btrim(customer_name)) = lower(btrim(p_customer_name)) and phone = v_phone
      for update;
    if found then
      v_order := o.id;
    else
      perform pg_advisory_xact_lock(hashtext('laundromat_order_id'));
      insert into public.orders (id, customer_name, phone, opened_by)
      values (public.next_order_id(now()), btrim(p_customer_name), v_phone, v_uid)
      returning * into o;
      v_order := o.id;
      perform public.log_audit('orders', o.id::text, 'open', null, to_jsonb(o));
    end if;
  end if;

  begin
    insert into public.tickets (
      kind, machine_id, level, base_minutes, service_price, spin_minutes, order_id,
      detergent_qty, detergent_unit_price, fabcon_qty, fabcon_unit_price, created_by
    ) values (
      'machine', m.id, p_level, svc.default_minutes, svc.price, coalesce(spin.default_minutes, 5), v_order,
      p_detergent_qty, coalesce(det.price, 0), p_fabcon_qty, coalesce(fab.price, 0), v_uid
    )
    returning * into t;
  exception when exclusion_violation then
    select max(ends_at) into busy_until from public.tickets
      where machine_id = m.id and voided_at is null and ends_at > now();
    raise exception 'machine % is busy until %', m.label,
      to_char(busy_until at time zone (select timezone from public.settings), 'HH24:MI');
  end;

  perform public.log_audit('tickets', t.id::text, 'create', null, to_jsonb(t));
  return t.id;
end;
$$;

-- pay_order: pay every pending job of an order in one go --------------------------------------
create function public.pay_order(
  p_order_id bigint, p_amount_paid numeric, p_payment_method public.payment_method,
  p_reference_no text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  o public.orders;
  v_n integer;
  v_total numeric;
  v_running text;
  v_last uuid;
  v_last_total numeric;
  v_diff numeric;
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;
  if p_amount_paid is null or p_amount_paid < 0 then raise exception 'enter the amount paid'; end if;
  if p_payment_method <> 'cash' and nullif(btrim(p_reference_no), '') is null then
    raise exception 'a reference number is required for non-cash payments';
  end if;

  select * into o from public.orders where id = p_order_id for update;
  if not found then raise exception 'order not found'; end if;
  if o.status <> 'open' then raise exception 'this order is already closed'; end if;

  perform 1 from public.tickets where order_id = o.id and status = 'pending' and voided_at is null for update;
  select count(*), coalesce(sum(total), 0) into v_n, v_total
  from public.tickets where order_id = o.id and status = 'pending' and voided_at is null;
  if v_n = 0 then raise exception 'nothing left to pay on this order'; end if;

  select m.label into v_running
  from public.tickets t join public.machines m on m.id = t.machine_id
  where t.order_id = o.id and t.status = 'pending' and t.voided_at is null and t.ends_at > now()
  order by t.ends_at limit 1;
  if v_running is not null then
    raise exception '% is still running; pay the finished jobs one at a time, or wait', v_running;
  end if;

  select id, total into v_last, v_last_total from public.tickets
  where order_id = o.id and status = 'pending' and voided_at is null
  order by started_at desc, id desc limit 1;
  v_diff := p_amount_paid - v_total;
  if v_last_total + v_diff < 0 then raise exception 'the amount paid is too far below the total'; end if;

  -- Each job is paid its own total; any difference lands on the last job, so the payment-mismatch
  -- check still sees it.
  with u as (
    update public.tickets set
      status = 'completed', completed_at = now(), completed_by = (select auth.uid()),
      amount_paid = total + case when id = v_last then v_diff else 0 end,
      payment_method = p_payment_method, reference_no = nullif(btrim(p_reference_no), '')
    where order_id = o.id and status = 'pending' and voided_at is null
    returning *
  )
  insert into public.audit_log (table_name, row_id, action, actor, after)
  select 'tickets', u.id::text, 'complete', (select auth.uid()), to_jsonb(u) from u;

  perform public.log_audit('orders', o.id::text, 'pay_order', to_jsonb(o),
    jsonb_build_object('amount_paid', p_amount_paid, 'jobs', v_n, 'total', v_total));
end;
$$;

-- Access --------------------------------------------------------------------------------------
alter table public.orders enable row level security;
revoke insert, update, delete on public.orders from authenticated;
create policy orders_select on public.orders for select to authenticated
  using ((select public.app_role()) = 'admin'
         or ((select public.app_role()) is not null and status = 'open'));

-- Today's orders for the Today list (staff cannot read closed orders directly).
create function public.todays_orders()
returns setof public.orders
language sql stable security definer
set search_path = ''
as $$
  select o.*
  from public.orders o
  cross join public.settings s
  where (select public.app_role()) is not null
    and (o.status = 'open'
         or (o.opened_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date
         or (o.closed_at at time zone s.timezone)::date = (now() at time zone s.timezone)::date)
  order by o.opened_at desc;
$$;

revoke all on function public.normalize_phone(text) from public, anon;
revoke all on function public.next_order_id(timestamptz) from public, anon, authenticated;
revoke all on function public.tickets_sync_order() from public, anon, authenticated;
revoke all on function public.todays_orders() from public, anon;
revoke all on function public.create_ticket(uuid, public.service_level, integer, integer, bigint, text, text) from public, anon;
revoke all on function public.pay_order(bigint, numeric, public.payment_method, text) from public, anon;
grant execute on function public.normalize_phone(text) to authenticated;
grant execute on function public.todays_orders() to authenticated;
grant execute on function public.create_ticket(uuid, public.service_level, integer, integer, bigint, text, text) to authenticated;
grant execute on function public.pay_order(bigint, numeric, public.payment_method, text) to authenticated;

alter publication supabase_realtime add table public.orders;

-- Reports: one payment for a whole order is not a repeated reference.
create or replace view public.stg_tickets with (security_invoker = on) as
select
  t.id as ticket_id, t.kind, t.status, t.machine_id, t.level, t.started_at, t.completed_at,
  (t.started_at   at time zone s.timezone)::date as start_date,
  (t.completed_at at time zone s.timezone)::date as completion_date,
  t.base_minutes, t.extra_dry_minutes, t.extra_spin_count, t.spin_minutes, t.detergent_qty, t.fabcon_qty,
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
  t.total, t.amount_paid, t.payment_method, t.reference_no, t.created_by, t.completed_by,
  t.order_id
from public.tickets t
cross join public.settings s
where t.voided_at is null
  and (select public.app_role()) = 'admin';

create or replace view public.dq_repeated_references with (security_invoker = on) as
with r as (
  select ticket_id, completion_date, payment_method, reference_no,
         coalesce(order_id::text, ticket_id::text) as pay_key
  from public.stg_tickets
  where status = 'completed' and reference_no is not null
)
select r.ticket_id, r.completion_date as business_date, r.payment_method, r.reference_no, g.times_used
from r
join (select payment_method, reference_no, count(distinct pay_key) as times_used
      from r group by payment_method, reference_no) g
  using (payment_method, reference_no);
