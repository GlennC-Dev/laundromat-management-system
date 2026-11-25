-- Detergent and fabric conditioner are washer items: a dryer ticket cannot carry them.
-- (Counter sales still sell them on their own; this rule is for machine jobs.)
-- Existing dryer tickets are untouched; the rule applies to new and pending tickets only.
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
    if (new.detergent_qty > 0 or new.fabcon_qty > 0) and m.type <> 'wash' then
      raise exception 'detergent and fabric conditioner apply to washers only';
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
