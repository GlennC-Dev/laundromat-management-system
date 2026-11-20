-- Halt: a staff member can stop a machine job within the first minute for any reason, with no admin
-- approval. After that window it is an ordinary void (admin only, or staff with an admin override).
-- A halt is stored as a void with a halt reason, so reports can tell the two apart. The machine
-- cannot start another job for 60 seconds after a halt. (Both 60-second limits are mirrored in the app.)

create type public.halt_reason as enum
  ('machine_error', 'door_problem', 'wrong_cycle', 'customer_changed_mind', 'other');

alter table public.tickets add column halt_reason public.halt_reason;
alter table public.tickets add constraint tickets_halt_is_void check (halt_reason is null or voided_at is not null);
create index tickets_recent_halts on public.tickets (machine_id, voided_at) where halt_reason is not null;

-- A halt changes only the void fields (now including halt_reason), like any void.
create or replace function public.tickets_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  m public.machines;
  frozen jsonb;
begin
  if tg_op = 'UPDATE' then
    if old.voided_at is not null then
      raise exception 'voided tickets are locked';
    end if;

    frozen := to_jsonb(new) - 'voided_at' - 'void_reason' - 'voided_by' - 'total' - 'halt_reason';
    if new.voided_at is not null then
      -- A void changes only the void fields, on a pending or a completed ticket.
      if frozen is distinct from (to_jsonb(old) - 'voided_at' - 'void_reason' - 'voided_by' - 'total' - 'halt_reason') then
        raise exception 'a void cannot change any other field';
      end if;
      return new;
    end if;

    if old.status = 'completed' then
      raise exception 'completed tickets are locked';
    end if;

    if new.id is distinct from old.id or new.kind is distinct from old.kind
       or new.machine_id is distinct from old.machine_id or new.level is distinct from old.level
       or new.started_at is distinct from old.started_at or new.base_minutes is distinct from old.base_minutes
       or new.service_price is distinct from old.service_price or new.spin_minutes is distinct from old.spin_minutes
       or new.created_by is distinct from old.created_by then
      raise exception 'machine, size, level and start of a pending ticket cannot change';
    end if;
    if new.extra_dry_minutes < old.extra_dry_minutes or new.extra_spin_count < old.extra_spin_count
       or new.detergent_qty < old.detergent_qty or new.fabcon_qty < old.fabcon_qty then
      raise exception 'a pending ticket can only gain add-ons';
    end if;
  end if;

  if new.kind = 'machine' then
    select * into m from public.machines where id = new.machine_id;
    if tg_op = 'INSERT' and not (m.active and m.status = 'available') then
      raise exception 'machine % is not available', m.label;
    end if;
    if (m.type = 'wash') <> (new.level in ('clean', 'cleaner', 'cleanest')) then
      raise exception 'level % does not match a % machine', new.level, m.type;
    end if;
    if new.extra_dry_minutes > 0 and m.type <> 'dry' then
      raise exception 'extra dry minutes apply to dryers only';
    end if;
    if new.extra_spin_count > 0 and m.type <> 'wash' then
      raise exception 'extra spins apply to washers only';
    end if;
    new.ends_at := new.started_at
      + make_interval(mins => new.base_minutes + new.extra_dry_minutes + new.extra_spin_count * new.spin_minutes);
  else
    new.ends_at := new.started_at;
  end if;

  if new.detergent_qty > 0 or new.fabcon_qty > 0 then
    perform pg_advisory_xact_lock(hashtext('laundromat_stock'));
    if new.detergent_qty > public.stock_balance('detergent', new.id) then
      raise exception 'out of stock: detergent';
    end if;
    if new.fabcon_qty > public.stock_balance('fabcon', new.id) then
      raise exception 'out of stock: fabcon';
    end if;
  end if;

  return new;
end;
$$;

-- create_ticket now refuses a machine that was just halted.
create or replace function public.create_ticket(
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
  v_wait integer;
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

create function public.halt_ticket(p_ticket_id uuid, p_reason public.halt_reason, p_note text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  t public.tickets;
  after_row public.tickets;
  v_label text;
  v_note text := nullif(btrim(p_note), '');
begin
  if (select public.app_role()) is null then raise exception 'not allowed'; end if;

  select * into t from public.tickets where id = p_ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;
  if t.voided_at is not null then raise exception 'ticket is already voided'; end if;
  if t.kind <> 'machine' or t.status <> 'pending' then
    raise exception 'only a running machine job can be halted';
  end if;
  if now() > t.started_at + interval '60 seconds' then
    raise exception 'the halt window has passed; this needs a void with admin approval';
  end if;
  if p_reason = 'other' and v_note is null then raise exception 'describe the problem'; end if;

  v_label := case p_reason
    when 'machine_error' then 'Machine error'
    when 'door_problem' then 'Door or lid problem'
    when 'wrong_cycle' then 'Wrong cycle'
    when 'customer_changed_mind' then 'Customer changed mind'
    else 'Other' end;

  update public.tickets set
    voided_at = now(),
    void_reason = 'Halted: ' || v_label || coalesce(' - ' || v_note, ''),
    voided_by = (select auth.uid()),
    halt_reason = p_reason
  where id = t.id
  returning * into after_row;

  perform public.log_audit('tickets', t.id::text, 'halt', to_jsonb(t), to_jsonb(after_row));
end;
$$;

revoke all on function public.halt_ticket(uuid, public.halt_reason, text) from public, anon;
grant execute on function public.halt_ticket(uuid, public.halt_reason, text) to authenticated;
