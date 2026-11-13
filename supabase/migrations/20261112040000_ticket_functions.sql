-- Stage 4: the business functions. Every ticket write goes through these; the API has no
-- direct write access to tickets. All run as the table owner but check the caller's role first.
-- Prices are snapshotted from the price list when a charge is first added to a ticket and are
-- kept for later additions of the same charge, so one ticket never mixes two prices for it.

-- Internal helpers (not callable from the API) ---------------------------------------------
create function public.shop_today()
returns date
language sql stable
set search_path = ''
as $$
  select (now() at time zone (select timezone from public.settings))::date;
$$;

create function public.price_in_effect(
  p_kind public.price_kind, p_code public.price_code, p_machine_type public.machine_type,
  p_size numeric, p_level public.service_level
)
returns public.price_list
language sql stable
set search_path = ''
as $$
  select pl.*
  from public.price_list pl
  where pl.kind = p_kind
    and pl.code is not distinct from p_code
    and pl.machine_type is not distinct from p_machine_type
    and pl.size_kg is not distinct from p_size
    and pl.level is not distinct from p_level
    and pl.effective_from <= public.shop_today()
  order by pl.effective_from desc
  limit 1;
$$;

create function public.log_audit(p_table text, p_row text, p_action text, p_before jsonb, p_after jsonb)
returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_log (table_name, row_id, action, actor, before, after)
  values (p_table, p_row, p_action, (select auth.uid()), p_before, p_after);
$$;

revoke all on function public.shop_today() from public, anon, authenticated;
revoke all on function public.price_in_effect(public.price_kind, public.price_code, public.machine_type, numeric, public.service_level) from public, anon, authenticated;
revoke all on function public.log_audit(text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- create_ticket ----------------------------------------------------------------------------
create function public.create_ticket(
  p_machine_id uuid, p_level public.service_level,
  p_detergent_qty integer default 0, p_fabcon_qty integer default 0
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
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;
  if p_detergent_qty < 0 or p_fabcon_qty < 0 then raise exception 'quantities cannot be negative'; end if;

  select * into m from public.machines where id = p_machine_id;
  if not found then raise exception 'unknown machine'; end if;
  if (m.type = 'wash') <> (p_level in ('clean', 'cleaner', 'cleanest')) then
    raise exception 'level % does not match a % machine', p_level, m.type;
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

  begin
    insert into public.tickets (
      kind, machine_id, level, base_minutes, service_price, spin_minutes,
      detergent_qty, detergent_unit_price, fabcon_qty, fabcon_unit_price, created_by
    ) values (
      'machine', m.id, p_level, svc.default_minutes, svc.price, coalesce(spin.default_minutes, 5),
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

-- add_to_ticket ----------------------------------------------------------------------------
create function public.add_to_ticket(
  p_ticket_id uuid, p_extra_dry_minutes integer default 0, p_extra_spins integer default 0,
  p_detergent_qty integer default 0, p_fabcon_qty integer default 0
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tickets;
  after_row public.tickets;
  m public.machines;
  p public.price_list;
  v_dry_price numeric;
  v_spin_price numeric;
  v_det_price numeric;
  v_fab_price numeric;
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;
  if least(p_extra_dry_minutes, p_extra_spins, p_detergent_qty, p_fabcon_qty) < 0 then
    raise exception 'quantities cannot be negative';
  end if;
  if p_extra_dry_minutes + p_extra_spins + p_detergent_qty + p_fabcon_qty = 0 then
    raise exception 'nothing to add';
  end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if t.voided_at is not null then raise exception 'ticket is voided'; end if;
  if t.status <> 'pending' then raise exception 'only a pending ticket can be edited'; end if;
  select * into m from public.machines where id = t.machine_id;

  v_dry_price := t.dry_ext_unit_price;
  v_spin_price := t.spin_unit_price;
  v_det_price := t.detergent_unit_price;
  v_fab_price := t.fabcon_unit_price;

  if p_extra_dry_minutes > 0 then
    if m.type <> 'dry' then raise exception 'extra dry minutes apply to dryers only'; end if;
    if p_extra_dry_minutes % 5 <> 0 then raise exception 'extra dry time is added in 5-minute steps'; end if;
    if t.extra_dry_minutes = 0 then
      p := public.price_in_effect('add_on', 'dry_extension', 'dry', m.capacity_kg, null);
      if p.id is null then raise exception 'no extra-time price set for % kg dryers', trim_scale(m.capacity_kg); end if;
      v_dry_price := p.price;
    end if;
  end if;
  if p_extra_spins > 0 then
    if m.type <> 'wash' then raise exception 'extra spins apply to washers only'; end if;
    if t.extra_spin_count = 0 then
      p := public.price_in_effect('add_on', 'extra_spin', 'wash', null, null);
      if p.id is null then raise exception 'no extra spin price set'; end if;
      v_spin_price := p.price;
    end if;
  end if;
  if p_detergent_qty > 0 and t.detergent_qty = 0 then
    p := public.price_in_effect('item', 'detergent', null, null, null);
    if p.id is null then raise exception 'no detergent price set'; end if;
    v_det_price := p.price;
  end if;
  if p_fabcon_qty > 0 and t.fabcon_qty = 0 then
    p := public.price_in_effect('item', 'fabcon', null, null, null);
    if p.id is null then raise exception 'no fabric conditioner price set'; end if;
    v_fab_price := p.price;
  end if;

  update public.tickets set
    extra_dry_minutes = t.extra_dry_minutes + p_extra_dry_minutes,
    extra_spin_count = t.extra_spin_count + p_extra_spins,
    detergent_qty = t.detergent_qty + p_detergent_qty,
    fabcon_qty = t.fabcon_qty + p_fabcon_qty,
    dry_ext_unit_price = v_dry_price,
    spin_unit_price = v_spin_price,
    detergent_unit_price = v_det_price,
    fabcon_unit_price = v_fab_price
  where id = t.id
  returning * into after_row;

  perform public.log_audit('tickets', t.id::text, 'add', to_jsonb(t), to_jsonb(after_row));
end;
$$;

-- complete_ticket --------------------------------------------------------------------------
create function public.complete_ticket(
  p_ticket_id uuid, p_amount_paid numeric, p_payment_method public.payment_method,
  p_reference_no text default null
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tickets;
  after_row public.tickets;
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;
  if p_amount_paid is null or p_amount_paid < 0 then raise exception 'enter the amount paid'; end if;
  if p_payment_method <> 'cash' and nullif(btrim(p_reference_no), '') is null then
    raise exception 'a reference number is required for non-cash payments';
  end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if t.voided_at is not null then raise exception 'ticket is voided'; end if;
  if t.status <> 'pending' then raise exception 'ticket is already completed'; end if;

  update public.tickets set
    status = 'completed', completed_at = now(), completed_by = (select auth.uid()),
    amount_paid = p_amount_paid, payment_method = p_payment_method,
    reference_no = nullif(btrim(p_reference_no), '')
  where id = t.id
  returning * into after_row;

  perform public.log_audit('tickets', t.id::text, 'complete', to_jsonb(t), to_jsonb(after_row));
end;
$$;

-- counter_sale -----------------------------------------------------------------------------
create function public.counter_sale(
  p_detergent_qty integer, p_fabcon_qty integer, p_amount_paid numeric,
  p_payment_method public.payment_method, p_reference_no text default null
)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  det public.price_list;
  fab public.price_list;
  t public.tickets;
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;
  if p_detergent_qty < 0 or p_fabcon_qty < 0 then raise exception 'quantities cannot be negative'; end if;
  if p_detergent_qty + p_fabcon_qty = 0 then raise exception 'a counter sale needs at least one item'; end if;
  if p_amount_paid is null or p_amount_paid < 0 then raise exception 'enter the amount paid'; end if;
  if p_payment_method <> 'cash' and nullif(btrim(p_reference_no), '') is null then
    raise exception 'a reference number is required for non-cash payments';
  end if;

  if p_detergent_qty > 0 then
    det := public.price_in_effect('item', 'detergent', null, null, null);
    if det.id is null then raise exception 'no detergent price set'; end if;
  end if;
  if p_fabcon_qty > 0 then
    fab := public.price_in_effect('item', 'fabcon', null, null, null);
    if fab.id is null then raise exception 'no fabric conditioner price set'; end if;
  end if;

  insert into public.tickets (
    kind, detergent_qty, detergent_unit_price, fabcon_qty, fabcon_unit_price,
    status, completed_at, completed_by, amount_paid, payment_method, reference_no, created_by
  ) values (
    'counter', p_detergent_qty, coalesce(det.price, 0), p_fabcon_qty, coalesce(fab.price, 0),
    'completed', now(), v_uid, p_amount_paid, p_payment_method, nullif(btrim(p_reference_no), ''), v_uid
  )
  returning * into t;

  perform public.log_audit('tickets', t.id::text, 'counter_sale', null, to_jsonb(t));
  return t.id;
end;
$$;

-- void_ticket (admin only) -----------------------------------------------------------------
create function public.void_ticket(p_ticket_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tickets;
  after_row public.tickets;
begin
  if (select public.app_role()) is distinct from 'admin' then raise exception 'only an admin can void a ticket'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'a void needs a reason'; end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if t.voided_at is not null then raise exception 'ticket is already voided'; end if;

  update public.tickets set
    voided_at = now(), void_reason = btrim(p_reason), voided_by = (select auth.uid())
  where id = t.id
  returning * into after_row;

  perform public.log_audit('tickets', t.id::text, 'void', to_jsonb(t), to_jsonb(after_row));
end;
$$;

-- Only signed-in users may call the business functions ------------------------------------
revoke all on function public.create_ticket(uuid, public.service_level, integer, integer) from public, anon;
revoke all on function public.add_to_ticket(uuid, integer, integer, integer, integer) from public, anon;
revoke all on function public.complete_ticket(uuid, numeric, public.payment_method, text) from public, anon;
revoke all on function public.counter_sale(integer, integer, numeric, public.payment_method, text) from public, anon;
revoke all on function public.void_ticket(uuid, text) from public, anon;
grant execute on function public.create_ticket(uuid, public.service_level, integer, integer) to authenticated;
grant execute on function public.add_to_ticket(uuid, integer, integer, integer, integer) to authenticated;
grant execute on function public.complete_ticket(uuid, numeric, public.payment_method, text) to authenticated;
grant execute on function public.counter_sale(integer, integer, numeric, public.payment_method, text) to authenticated;
grant execute on function public.void_ticket(uuid, text) to authenticated;
