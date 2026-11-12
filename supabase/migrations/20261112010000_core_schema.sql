-- Stage 2a: core tables, enums, constraints and indexes.
-- Row-level security is enabled on every table with no policies, so nothing is
-- readable or writable through the API until stage 3 adds explicit policies.

create type public.user_role      as enum ('admin', 'staff');
create type public.machine_type   as enum ('wash', 'dry');
create type public.machine_status as enum ('available', 'out_of_service');
create type public.service_level  as enum ('clean', 'cleaner', 'cleanest', 'dry', 'drier', 'driest');
create type public.price_kind     as enum ('service', 'add_on', 'item');
create type public.price_code     as enum ('extra_spin', 'dry_extension', 'detergent', 'fabcon');
create type public.stock_item     as enum ('detergent', 'fabcon');
create type public.ticket_kind    as enum ('machine', 'counter');
create type public.ticket_status  as enum ('pending', 'completed');
create type public.payment_method as enum ('cash', 'gcash', 'maya', 'bank_transfer', 'card');
create type public.utility_kind   as enum ('electricity', 'water');

-- profiles ------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (nullif(btrim(display_name), '') is not null),
  role         public.user_role not null default 'staff',
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- machines ------------------------------------------------------------------
create table public.machines (
  id                 uuid primary key default gen_random_uuid(),
  label              text not null unique check (nullif(btrim(label), '') is not null),
  type               public.machine_type not null,
  capacity_kg        numeric(5,1) not null check (capacity_kg > 0),
  motor_kw           numeric(6,3) not null check (motor_kw > 0),
  element_kw         numeric(6,3) check (element_kw > 0),
  water_l_per_cycle  numeric(7,1) check (water_l_per_cycle > 0),
  status             public.machine_status not null default 'available',
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  constraint machines_type_specs check (
    (type = 'dry'  and element_kw is not null and water_l_per_cycle is null) or
    (type = 'wash' and water_l_per_cycle is not null and element_kw is null)
  )
);

-- price_list (effective-dated) ---------------------------------------------
create table public.price_list (
  id              uuid primary key default gen_random_uuid(),
  kind            public.price_kind not null,
  code            public.price_code,
  machine_type    public.machine_type,
  size_kg         numeric(5,1) check (size_kg > 0),
  level           public.service_level,
  price           numeric(10,2) not null check (price >= 0),
  default_minutes integer check (default_minutes > 0),
  effective_from  date not null,
  created_at      timestamptz not null default now(),
  constraint price_list_shape check (
    (kind = 'service' and code is null and machine_type is not null and size_kg is not null
       and level is not null and default_minutes is not null
       and (level in ('clean','cleaner','cleanest')) = (machine_type = 'wash'))
    or
    (kind = 'add_on' and code in ('extra_spin','dry_extension') and level is null and default_minutes is not null
       and ((code = 'extra_spin' and machine_type = 'wash' and size_kg is null)
         or (code = 'dry_extension' and machine_type = 'dry' and size_kg is not null)))
    or
    (kind = 'item' and code in ('detergent','fabcon') and machine_type is null and size_kg is null
       and level is null and default_minutes is null)
  )
);
create unique index price_list_unique_version on public.price_list
  (kind, code, machine_type, size_kg, level, effective_from) nulls not distinct;
create index price_list_lookup on public.price_list (kind, code, machine_type, size_kg, level, effective_from desc);

-- settings (single row) -----------------------------------------------------
create table public.settings (
  id                   boolean primary key default true check (id),
  opening_time         time not null default '08:00',
  closing_time         time not null default '21:00',
  currency             text not null default 'PHP',
  timezone             text not null default 'Asia/Manila',
  washer_load_factor   numeric(4,3) not null default 0.7 check (washer_load_factor > 0 and washer_load_factor <= 1),
  dryer_duty_dry       numeric(4,3) not null default 0.6 check (dryer_duty_dry > 0 and dryer_duty_dry <= 1),
  dryer_duty_drier     numeric(4,3) not null default 0.6 check (dryer_duty_drier > 0 and dryer_duty_drier <= 1),
  dryer_duty_driest    numeric(4,3) not null default 0.6 check (dryer_duty_driest > 0 and dryer_duty_driest <= 1),
  water_factor_clean    numeric(4,3) not null default 1.0 check (water_factor_clean > 0),
  water_factor_cleaner  numeric(4,3) not null default 1.0 check (water_factor_cleaner > 0),
  water_factor_cleanest numeric(4,3) not null default 1.0 check (water_factor_cleanest > 0),
  constraint settings_open_before_close check (closing_time > opening_time)
);
insert into public.settings default values;

-- utility_rates (effective-dated) ------------------------------------------
create table public.utility_rates (
  id             uuid primary key default gen_random_uuid(),
  kind           public.utility_kind not null,
  rate           numeric(10,4) not null check (rate >= 0),
  effective_from date not null,
  unique (kind, effective_from)
);

-- restocks (append-only) ----------------------------------------------------
create table public.restocks (
  id           uuid primary key default gen_random_uuid(),
  item         public.stock_item not null,
  doses        integer not null check (doses > 0),
  unit_cost    numeric(10,2) not null check (unit_cost >= 0),
  restocked_at timestamptz not null default now(),
  created_by   uuid not null references public.profiles (id)
);
create index restocks_item_time on public.restocks (item, restocked_at);

-- tickets -------------------------------------------------------------------
create table public.tickets (
  id                    uuid primary key default gen_random_uuid(),
  kind                  public.ticket_kind not null,
  machine_id            uuid references public.machines (id) on delete restrict,
  level                 public.service_level,
  started_at            timestamptz not null default now(),
  base_minutes          integer check (base_minutes > 0),
  extra_dry_minutes     integer not null default 0 check (extra_dry_minutes >= 0 and extra_dry_minutes % 5 = 0),
  extra_spin_count      integer not null default 0 check (extra_spin_count >= 0),
  spin_minutes          integer not null default 5 check (spin_minutes > 0),
  detergent_qty         integer not null default 0 check (detergent_qty >= 0),
  fabcon_qty            integer not null default 0 check (fabcon_qty >= 0),
  -- Price snapshots, copied from price_list when the charge is added.
  service_price         numeric(10,2) check (service_price >= 0),
  dry_ext_unit_price    numeric(10,2) not null default 0 check (dry_ext_unit_price >= 0), -- per 5 minutes
  spin_unit_price       numeric(10,2) not null default 0 check (spin_unit_price >= 0),
  detergent_unit_price  numeric(10,2) not null default 0 check (detergent_unit_price >= 0),
  fabcon_unit_price     numeric(10,2) not null default 0 check (fabcon_unit_price >= 0),
  total                 numeric(12,2) generated always as (
    coalesce(service_price, 0)
    + (extra_dry_minutes / 5) * dry_ext_unit_price
    + extra_spin_count * spin_unit_price
    + detergent_qty * detergent_unit_price
    + fabcon_qty * fabcon_unit_price
  ) stored,
  ends_at               timestamptz not null, -- scheduled end; maintained by trigger
  status                public.ticket_status not null default 'pending',
  completed_at          timestamptz,
  completed_by          uuid references public.profiles (id),
  amount_paid           numeric(12,2) check (amount_paid >= 0),
  payment_method        public.payment_method,
  reference_no          text,
  created_by            uuid not null references public.profiles (id),
  voided_at             timestamptz,
  void_reason           text,
  voided_by             uuid references public.profiles (id),

  constraint tickets_shape check (
    (kind = 'machine' and machine_id is not null and level is not null
       and base_minutes is not null and service_price is not null)
    or
    (kind = 'counter' and machine_id is null and level is null and base_minutes is null
       and service_price is null and extra_dry_minutes = 0 and extra_spin_count = 0
       and detergent_qty + fabcon_qty > 0 and status = 'completed')
  ),
  constraint tickets_completion check (
    (status = 'pending' and completed_at is null and completed_by is null and amount_paid is null
       and payment_method is null and reference_no is null)
    or
    (status = 'completed' and completed_at is not null and completed_by is not null
       and amount_paid is not null and payment_method is not null
       and (payment_method = 'cash' or nullif(btrim(reference_no), '') is not null)
       and completed_at >= started_at)
  ),
  constraint tickets_void check (
    (voided_at is null and void_reason is null and voided_by is null)
    or
    (voided_at is not null and nullif(btrim(void_reason), '') is not null and voided_by is not null)
  ),
  -- A machine cannot have two overlapping runs (voided tickets free the machine).
  constraint tickets_no_overlapping_runs exclude using gist (
    machine_id with =,
    tstzrange(started_at, ends_at) with &&
  ) where (machine_id is not null and voided_at is null)
);
create index tickets_started_at   on public.tickets (started_at);
create index tickets_completed_at on public.tickets (completed_at) where status = 'completed';
create index tickets_pending      on public.tickets (started_at) where status = 'pending' and voided_at is null;

-- audit_log (append-only; written by business functions in stage 4) ---------
create table public.audit_log (
  id         bigint generated always as identity primary key,
  table_name text not null,
  row_id     text not null,
  action     text not null,
  actor      uuid references public.profiles (id),
  at         timestamptz not null default now(),
  before     jsonb,
  after      jsonb
);
create index audit_log_row on public.audit_log (table_name, row_id, at);

alter table public.profiles      enable row level security;
alter table public.machines      enable row level security;
alter table public.price_list    enable row level security;
alter table public.settings      enable row level security;
alter table public.utility_rates enable row level security;
alter table public.restocks      enable row level security;
alter table public.tickets       enable row level security;
alter table public.audit_log     enable row level security;
