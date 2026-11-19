-- Demo history generator: realistic tickets, restocks and a few voids for the demo shop.
--
-- Not a migration and not part of the tests. Run by hand against a demo project, after
-- demo-seed.sql (machines and prices) and with at least one admin user.
--
--   1. Run this whole file once to create the three helper functions.
--   2. Generate history in chunks (each call takes a few seconds), oldest first, ending before today:
--        select public.demo_generate_history(date '2026-08-21', date '2026-09-20');
--        select public.demo_generate_history(date '2026-09-21', date '2026-10-20');
--        select public.demo_generate_history(date '2026-10-21', date '2026-11-18');
--   3. Drop the helpers:
--        drop function public.demo_generate_history(date, date), public.demo_price(...), public.demo_at(...);
--
-- It writes through ordinary inserts, so every table constraint and trigger still applies (no
-- overlapping machine runs, stock can never go negative, snapshots, locks). Each day is seeded,
-- so the same range always produces the same history. It refuses to run if tickets already exist
-- on or after the start date.
--
-- What it models: a walk-in rhythm (morning and early-evening peaks, busy weekends, paydays, rainy
-- days that push people to the dryers), customers who wash then dry, dry-only customers, counter
-- sales, customers who leave when every machine is busy, late pick-ups, a few next-morning pick-ups,
-- occasional wrong amounts, about 1% voids, a mix of payment methods, restocks when supplies run low,
-- and an earlier, cheaper price list and utility rates so effective dating shows up in reports.
-- Staff are two deactivated demo accounts (Ana and Ben) that cannot sign in.

create or replace function public.demo_at(p_day date, p_hours numeric, p_tz text)
returns timestamptz
language sql immutable
as $$ select (p_day::timestamp + make_interval(secs => (p_hours * 3600)::float8)) at time zone p_tz $$;

create or replace function public.demo_price(
  p_kind public.price_kind, p_code public.price_code, p_mtype public.machine_type,
  p_size numeric, p_level public.service_level, p_on date
)
returns public.price_list
language sql stable
as $$
  select pl.* from public.price_list pl
  where pl.kind = p_kind and pl.code is not distinct from p_code
    and pl.machine_type is not distinct from p_mtype and pl.size_kg is not distinct from p_size
    and pl.level is not distinct from p_level and pl.effective_from <= p_on
  order by pl.effective_from desc limit 1
$$;

create or replace function public.demo_generate_history(p_from date, p_to date)
returns text
language plpgsql
set search_path = public
as $fn$
declare
  s public.settings;
  v_tz text;
  v_today date;
  v_admin uuid; v_ana uuid; v_ben uuid;
  d date;
  open_h numeric; close_h numeric; close_ts timestamptz; day_start timestamptz;
  dowf numeric; lam numeric; rainy boolean; n int; i int; h numeric; r numeric; k text;
  bal_det int; bal_fab int; det_cost numeric; fab_cost numeric;
  c record; w record; dr record; t record;
  svc public.price_list; spin public.price_list; extp public.price_list;
  pdet public.price_list; pfab public.price_list;
  lvl public.service_level; load12 boolean;
  det int; fab int; xs int; ext int;
  w_start timestamptz; w_end timestamptz; d_start timestamptz; d_end timestamptz;
  comp timestamptz; ovn boolean; lag numeric; da timestamptz;
  total numeric; paid numeric; method public.payment_method; ref text;
  void_it boolean; void_at timestamptz; void_reason text; reasons text[] :=
    array['Wrong machine', 'Customer cancelled', 'Rang up twice', 'Price dispute', 'Machine fault'];
  trow public.tickets;
  n_tickets int := 0; n_voids int := 0; n_lost int := 0; n_restocks int := 0;
begin
  select * into s from public.settings;
  v_tz := s.timezone;
  v_today := (now() at time zone v_tz)::date;
  if p_to >= v_today then raise exception 'history must end before today (%)', v_today; end if;
  if exists (select 1 from public.tickets where started_at >= public.demo_at(p_from, 0, v_tz)) then
    raise exception 'tickets already exist on or after %; generate only into an empty range', p_from;
  end if;

  select id into v_admin from public.profiles where role = 'admin' and active order by created_at limit 1;
  if v_admin is null then raise exception 'create an admin user first'; end if;
  select id into v_ana from public.profiles where display_name = 'Ana (demo)';
  if v_ana is null then
    insert into auth.users (id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'ana.demo@example.invalid', '{"display_name":"Ana (demo)"}') returning id into v_ana;
    update public.profiles set active = false where id = v_ana;
  end if;
  select id into v_ben from public.profiles where display_name = 'Ben (demo)';
  if v_ben is null then
    insert into auth.users (id, email, raw_user_meta_data)
    values (gen_random_uuid(), 'ben.demo@example.invalid', '{"display_name":"Ben (demo)"}') returning id into v_ben;
    update public.profiles set active = false where id = v_ben;
  end if;

  -- An earlier, cheaper price list and utility rates, so history spans a price change.
  insert into public.price_list (kind, code, machine_type, size_kg, level, price, default_minutes, effective_from)
  select e.kind, e.code, e.machine_type, e.size_kg, e.level,
         case e.kind when 'service' then greatest(5, round(e.price * 0.9 / 5) * 5)
                     else greatest(1, round(e.price * 0.9)) end,
         e.default_minutes, date '2026-08-01'
  from (select distinct on (kind, code, machine_type, size_kg, level) *
        from public.price_list order by kind, code, machine_type, size_kg, level, effective_from) e
  where e.effective_from > date '2026-08-01';
  insert into public.utility_rates (kind, rate, effective_from)
  select e.kind, round(e.rate * 0.93, 2), date '2026-08-01'
  from (select distinct on (kind) * from public.utility_rates order by kind, effective_from) e
  where e.effective_from > date '2026-08-01';

  open_h := extract(epoch from s.opening_time) / 3600;
  close_h := extract(epoch from s.closing_time) / 3600;

  create temp table if not exists m_state (id uuid, type public.machine_type, cap numeric, free_at timestamptz);
  delete from m_state;
  insert into m_state select id, type, capacity_kg, now() from public.machines where active and status = 'available';
  create temp table if not exists cu (arr timestamptz, k text);
  create temp table if not exists gp (
    kind public.ticket_kind, machine_id uuid, level public.service_level, started_at timestamptz,
    base int, xdry int default 0, xspin int default 0, spinmin int default 5, det int default 0, fab int default 0,
    svc numeric, dryp numeric default 0, spinp numeric default 0, detp numeric default 0, fabp numeric default 0,
    comp timestamptz, ovn boolean default false);
  delete from cu; delete from gp;

  for d in select g::date from generate_series(p_from, p_to, interval '1 day') g loop
    perform setseed(((d - date '2026-01-01') % 997)::float8 / 1000.0);
    day_start := public.demo_at(d, 0, v_tz);
    close_ts := public.demo_at(d, close_h, v_tz);

    -- Supplies: reorder at the start of the day when running low (cost drifts up over time).
    bal_det := (select coalesce(sum(doses), 0) from public.restocks where item = 'detergent' and restocked_at < day_start)
             - (select coalesce(sum(detergent_qty), 0) from public.tickets where voided_at is null and started_at < day_start);
    bal_fab := (select coalesce(sum(doses), 0) from public.restocks where item = 'fabcon' and restocked_at < day_start)
             - (select coalesce(sum(fabcon_qty), 0) from public.tickets where voided_at is null and started_at < day_start);
    det_cost := case when d < date '2026-09-20' then 16 when d < date '2026-11-01' then 17 else 18 end;
    fab_cost := det_cost - 3;
    if bal_det < 50 then
      insert into public.restocks (item, doses, unit_cost, restocked_at, created_by)
      values ('detergent', 100, det_cost, public.demo_at(d, open_h - 0.5, v_tz), v_admin);
      n_restocks := n_restocks + 1;
    end if;
    if bal_fab < 40 then
      insert into public.restocks (item, doses, unit_cost, restocked_at, created_by)
      values ('fabcon', 80, fab_cost, public.demo_at(d, open_h - 0.5, v_tz), v_admin);
      n_restocks := n_restocks + 1;
    end if;

    -- How busy is today?
    dowf := case extract(isodow from d) when 1 then .9 when 2 then .85 when 3 then .9 when 4 then .95
                                          when 5 then 1.1 when 6 then 1.45 else 1.35 end;
    if extract(day from d) in (15, 30) or d = (date_trunc('month', d) + interval '1 month - 1 day')::date then
      dowf := dowf * 1.25;
    elsif extract(day from d) in (1, 16) then
      dowf := dowf * 1.1;
    end if;
    rainy := random() < 0.3;
    lam := 24 * dowf * (1 + 0.002 * (d - date '2026-08-20')) * (0.8 + 0.4 * random())
           * case when rainy then 1.1 else 1 end;
    n := round(lam);

    delete from cu; delete from gp;
    update m_state set free_at = public.demo_at(d, open_h, v_tz);

    for i in 1..n loop
      loop  -- arrival hour: morning and early-evening peaks
        h := open_h + random() * (close_h - 1 - open_h);
        exit when random() * 21 < 3 + 7 * exp(-power((h - 10) / 1.5, 2)) + 9 * exp(-power((h - 18) / 1.8, 2))
                                    + 3 * exp(-power((h - 13.5) / 1.5, 2));
      end loop;
      r := random();
      k := case when r < .10 then 'counter'
                when r < .28 + case when rainy then .07 else 0 end then 'dry'
                when r < .41 + case when rainy then .07 else 0 end then 'wash'
                else 'washdry' end;
      insert into cu values (public.demo_at(d, h, v_tz), k);
    end loop;

    for c in select * from cu order by arr loop
      pdet := public.demo_price('item', 'detergent', null, null, null, d);
      pfab := public.demo_price('item', 'fabcon', null, null, null, d);
      da := null;

      if c.k = 'counter' then
        det := case when pdet.id is not null and random() < .75 then 1 + (random() < .3)::int else 0 end;
        fab := case when pfab.id is not null and random() < .5 then 1 else 0 end;
        if det + fab = 0 then
          if pdet.id is null then continue; end if;
          det := 1;
        end if;
        insert into gp (kind, started_at, det, fab, detp, fabp, comp)
        values ('counter', c.arr, det, fab, case when det > 0 then pdet.price else 0 end,
                case when fab > 0 then pfab.price else 0 end, c.arr);
        continue;
      end if;

      if c.k in ('wash', 'washdry') then
        load12 := random() < .3;
        select * into w from m_state
        where type = 'wash' and (not load12 or cap >= 12) and free_at <= c.arr + interval '12 minutes'
        order by (cap = case when load12 then 12 else 8 end) desc, free_at limit 1;
        if not found then n_lost := n_lost + 1; continue; end if;
        w_start := greatest(c.arr, w.free_at);
        r := random();
        lvl := case when r < .5 then 'clean' when r < .85 then 'cleaner' else 'cleanest' end;
        svc := public.demo_price('service', null, 'wash', w.cap, lvl, d);
        if svc.id is null then continue; end if;
        spin := public.demo_price('add_on', 'extra_spin', 'wash', null, null, d);
        xs := case when spin.id is not null and random() < .10 then 1 + (random() < .15)::int else 0 end;
        r := random();
        det := case when pdet.id is null or r < .35 then 0 when r < .90 then 1 else 2 end;
        fab := case when pfab.id is not null and random() < .45 then 1 else 0 end;
        w_end := w_start + make_interval(mins => svc.default_minutes + xs * coalesce(spin.default_minutes, 5));
        lag := 4 + random() * 16 + case when random() < .05 then 30 + random() * 60 else 0 end;
        comp := w_end + make_interval(secs => (lag * 60)::float8);
        ovn := false;
        if comp > close_ts then
          if d < v_today - 1 and random() < .35 then
            ovn := true; comp := public.demo_at(d + 1, (open_h + .1 + random() * 1.3)::numeric, v_tz);
          else
            comp := greatest(w_end + interval '2 minutes', close_ts + make_interval(secs => (random() * 1200)::float8));
          end if;
        end if;
        insert into gp (kind, machine_id, level, started_at, base, xspin, spinmin, det, fab, svc, spinp, detp, fabp, comp, ovn)
        values ('machine', w.id, lvl, w_start, svc.default_minutes, xs, coalesce(spin.default_minutes, 5), det, fab,
                svc.price, case when xs > 0 then spin.price else 0 end,
                case when det > 0 then pdet.price else 0 end, case when fab > 0 then pfab.price else 0 end, comp, ovn);
        update m_state set free_at = w_end + interval '3 minutes' where id = w.id;
        if c.k = 'washdry' and not ovn then da := comp + interval '3 minutes'; end if;
      else
        da := c.arr;
      end if;

      if da is not null then
        select * into dr from m_state where type = 'dry' and free_at <= da + interval '40 minutes'
        order by free_at limit 1;
        if not found then n_lost := n_lost + 1; continue; end if;
        d_start := greatest(da, dr.free_at);
        r := random();
        lvl := case when rainy then (case when r < .30 then 'dry' when r < .75 then 'drier' else 'driest' end)
                    else (case when r < .40 then 'dry' when r < .80 then 'drier' else 'driest' end) end;
        svc := public.demo_price('service', null, 'dry', dr.cap, lvl, d);
        if svc.id is null then continue; end if;
        extp := public.demo_price('add_on', 'dry_extension', 'dry', dr.cap, null, d);
        ext := case when extp.id is not null and random() < .22 then 5 * (1 + floor(random() * 3)::int) else 0 end;
        d_end := d_start + make_interval(mins => svc.default_minutes + ext);
        if d_end > close_ts + interval '30 minutes' then continue; end if;
        lag := 3 + random() * 20;
        comp := d_end + make_interval(secs => (lag * 60)::float8);
        ovn := false;
        if comp > close_ts then
          comp := greatest(d_end + interval '2 minutes', close_ts + make_interval(secs => (random() * 1200)::float8));
        end if;
        insert into gp (kind, machine_id, level, started_at, base, xdry, svc, dryp, comp, ovn)
        values ('machine', dr.id, lvl, d_start, svc.default_minutes, ext, svc.price,
                case when ext > 0 then extp.price else 0 end, comp, false);
        update m_state set free_at = d_end + interval '3 minutes' where id = dr.id;
      end if;
    end loop;

    -- Write the day, oldest first.
    for t in select * from gp order by started_at loop
      total := coalesce(t.svc, 0) + (t.xdry / 5) * t.dryp + t.xspin * t.spinp + t.det * t.detp + t.fab * t.fabp;
      r := random();
      method := case when r < .55 then 'cash' when r < .90 then 'gcash' when r < .95 then 'maya'
                     when r < .98 then 'card' else 'bank_transfer' end;
      ref := case when method = 'cash' then null
                  else lpad((100000000000 + floor(random() * 899999999999))::bigint::text, 12, '0') end;
      paid := total;
      if random() < .015 then paid := greatest(0, total + case when random() < .5 then -5 else 5 end); end if;
      void_it := not t.ovn and random() < .012;
      void_at := null; void_reason := null;
      if void_it then
        void_at := t.comp + make_interval(secs => ((2 + random() * 40) * 60)::float8);
        void_reason := reasons[1 + floor(random() * array_length(reasons, 1))::int];
      end if;

      insert into public.tickets (
        kind, machine_id, level, started_at, base_minutes, extra_dry_minutes, extra_spin_count, spin_minutes,
        detergent_qty, fabcon_qty, service_price, dry_ext_unit_price, spin_unit_price,
        detergent_unit_price, fabcon_unit_price, ends_at, status, completed_at, completed_by,
        amount_paid, payment_method, reference_no, created_by, voided_at, void_reason, voided_by
      ) values (
        t.kind, t.machine_id, t.level, t.started_at, t.base, t.xdry, t.xspin, t.spinmin,
        t.det, t.fab, t.svc, t.dryp, t.spinp, t.detp, t.fabp, t.started_at, 'completed', t.comp,
        case when (extract(epoch from (t.comp at time zone v_tz)::time) / 3600) < 14.5 then v_ana else v_ben end,
        paid, method, ref,
        case when (extract(epoch from (t.started_at at time zone v_tz)::time) / 3600) < 14.5 then v_ana else v_ben end,
        void_at, void_reason, case when void_it then v_admin end
      ) returning * into trow;
      n_tickets := n_tickets + 1;

      if void_it then
        n_voids := n_voids + 1;
        insert into public.audit_log (table_name, row_id, action, actor, before, after, at)
        values ('tickets', trow.id::text, 'void', v_admin,
                to_jsonb(trow) || jsonb_build_object('voided_at', null, 'void_reason', null, 'voided_by', null),
                to_jsonb(trow), trow.voided_at);
      end if;
    end loop;
  end loop;

  return format('%s tickets (%s voided), %s customers left with every machine busy, %s restocks, %s to %s',
                n_tickets, n_voids, n_lost, n_restocks, p_from, p_to);
end;
$fn$;
