-- Demo shop: 10 washers (8 x 8 kg, 2 x 12 kg), 4 dryers (2 x 12 kg, 2 x 16 kg), price list, utility rates.
-- Run by hand against a demo project (not part of migrations or tests). Machines and rates are
-- idempotent (re-running updates the machines to these specs); price rows are not, so run once.
insert into machines (label,type,capacity_kg,motor_kw,element_kw,water_l_per_cycle) values
('W1','wash',8,0.5,null,60),('W2','wash',8,0.5,null,60),('W3','wash',8,0.5,null,60),('W4','wash',8,0.5,null,60),
('W5','wash',8,0.5,null,60),('W6','wash',8,0.5,null,60),('W7','wash',8,0.5,null,60),('W8','wash',8,0.5,null,60),
('W9','wash',12,0.75,null,90),('W10','wash',12,0.75,null,90),
('D1','dry',12,0.4,5.0,null),('D2','dry',12,0.4,5.0,null),
('D3','dry',16,0.55,7.0,null),('D4','dry',16,0.55,7.0,null)
on conflict (label) do update set type = excluded.type, capacity_kg = excluded.capacity_kg, motor_kw = excluded.motor_kw,
  element_kw = excluded.element_kw, water_l_per_cycle = excluded.water_l_per_cycle;
insert into price_list (kind,code,machine_type,size_kg,level,price,default_minutes,effective_from) values
('service',null,'wash',8,'clean',60,30,'2026-11-15'),('service',null,'wash',8,'cleaner',80,40,'2026-11-15'),
('service',null,'wash',8,'cleanest',100,50,'2026-11-15'),('service',null,'wash',12,'clean',80,30,'2026-11-15'),
('service',null,'wash',12,'cleaner',100,40,'2026-11-15'),('service',null,'wash',12,'cleanest',130,50,'2026-11-15'),
('service',null,'dry',12,'dry',50,30,'2026-11-15'),('service',null,'dry',12,'drier',70,45,'2026-11-15'),
('service',null,'dry',12,'driest',90,60,'2026-11-15'),
('service',null,'dry',16,'dry',65,30,'2026-11-15'),('service',null,'dry',16,'drier',90,45,'2026-11-15'),
('service',null,'dry',16,'driest',115,60,'2026-11-15'),
('add_on','extra_spin','wash',null,null,15,10,'2026-11-15'),
('add_on','dry_extension','dry',12,null,10,10,'2026-11-15'),('add_on','dry_extension','dry',16,null,12,10,'2026-11-15'),
('item','detergent',null,null,null,20,null,'2026-11-15'),('item','fabcon',null,null,null,20,null,'2026-11-15');
insert into utility_rates (kind,rate,effective_from) values ('electricity',12.5,'2026-11-01'),('water',35,'2026-11-01') on conflict do nothing;
