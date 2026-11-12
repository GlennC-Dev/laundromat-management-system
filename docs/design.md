# Laundromat Management System: Design Doc

Nov 11, 2026

## Purpose and scope

A web app that runs one attendant-operated, Quicklean-style laundromat and turns its tickets into clean daily numbers. It is a portfolio showcase first and a usable product for a single-shop owner second.

- **Audience (phase 1):** one shop owner and their attendants. Multi-branch is phase 2.
- **Shop model:** attendant-operated, so staff run the machines. Not 24 hours; closes around 9pm.
- **Roles:** staff create, edit and complete jobs and log item sales. Admin controls everything else.
- **Showcase goal:** structured data transformation (wide tickets to modeled facts to daily marts) and owner-facing analysis. Forecasting waits until the core app works.
- **Market:** Philippines by default. Currency, timezone and rates are settings.
- **Delivery:** a repo plus a public demo on Supabase. A business deployment runs the same code on a database the business owns.

## Decisions log

These decisions were settled during the brainstorm. Anything still unsettled is under Open items.

| Area | Decision |
| --- | --- |
| Tenancy | One shop per deployment, no business id. Whoever deploys it owns the database. |
| Ticket | One ticket is one machine cycle (wash or dry) or one counter sale. A customer with two washes and a dry has three tickets. |
| Statuses | Only pending and completed. Pending tickets stay editable (add a spin, extend a dry, add detergent or fabcon). Completing takes payment info and locks the ticket. Completed means done and paid. |
| Void | Admin only, with a reason, logged. It is a flag on the ticket, not a third status. Completed tickets are never edited. |
| Payments | Logged only: amount, method, reference number. One payment per ticket. Reference required for non-cash; repeated references are flagged for review, not blocked. |
| Pricing | Set by the admin per machine type, size and level. Level changes both price and duration. Add-ons are priced separately. The price is copied onto the ticket when charged. |
| Levels | Washers: clean, cleaner, cleanest. Dryers: dry, drier, driest. |
| Machines | Dryers are electric. Washer hot-water energy is ignored because clothes come out of the wash not hot. Fleet sizes are in Defaults. |
| Inventory | Detergent and fabric conditioner only, sold separately because customers may bring their own. Stock is restocks minus sales. |
| Fixed costs | Not in v1. The report shows operating margin before fixed costs, never net profit. |
| Day boundary | Closing time is a setting (default 9pm). Revenue counts on the completion date. Usage (hours, kWh, litres) counts on the start date. |
| Staff logins | Individual accounts, so tickets record the attendant. Low priority. |
| Customers | Not tracked in v1. |
| Forecasting | After the core app works. Not in v1. |
| Stack | React, TypeScript and Vite as a PWA on Supabase. Recommended and accepted by default. |

## Data model

Eight tables hold everything the app writes. Every report number comes from views over them.

| Table | Holds | Key columns |
| --- | --- | --- |
| profiles | App users and roles | user id, display name, role (admin or staff) |
| machines | The fleet and its specs | label, type (wash or dry), capacity\_kg, motor\_kw, element\_kw (dryers), water\_l\_per\_cycle (washers), status, active |
| price\_list | Admin prices, effective-dated | kind (service, add-on, item), machine type, size\_kg, level, price, default minutes, effective\_from |
| tickets | Every machine cycle and counter sale | kind, machine, level, started\_at, base\_minutes, extra\_dry\_minutes, extra\_spin\_count, detergent\_qty, fabcon\_qty, price snapshots, total, status, completed\_at, amount\_paid, payment\_method, reference\_no, created\_by, completed\_by, voided\_at, void\_reason |
| restocks | Stock purchases | item, doses, unit\_cost, restocked\_at |
| settings | Shop settings and estimate assumptions | opening\_time, closing\_time, currency, timezone, washer load factor, dryer duty factor by level, water factor by level |
| utility\_rates | Electricity and water rates, effective-dated | kind, rate, effective\_from |
| audit\_log | Who changed what | table, row id, action, actor, at, before and after |

Derived and never stored: stock balance, per-ticket run facts, daily marts, data-quality checks.

The transformation layers run in one direction:

1. **Raw:** the tables above, untouched by reporting.
2. **Staging:** one row per machine ticket with computed minutes, kWh, litres and utility cost (using the rates and assumptions in effect that day), plus item-sale and payment facts.
3. **Marts:** daily machine utilization, daily P&L, stock balance, data-quality checks.
4. **Screens:** the EOD screen reads marts only.

Conventions: timestamps are stored in UTC, set by the server, and shown in the shop timezone. Money is an exact decimal, never a float.

## Business rules

Every rule below is enforced in the database through constraints, triggers and row-level security, so neither the app nor the data generator can bypass it.

**Ticket lifecycle**

- A ticket starts pending. A pending ticket can gain extra dry minutes, extra spins, detergent and fabcon. Machine, size and level are fixed at creation. Fixing a mistake means an admin void and a new ticket (default; see Open items).
- Completing requires an amount paid and a payment method, plus a reference number for any non-cash method. Completion stamps the time and the attendant, then locks the row.
- A trigger rejects any update to a completed ticket. The only change allowed is an admin void with a reason.
- A machine cannot have two overlapping runs. A run covers its start to its scheduled end, including extensions. A new ticket may start on a machine once the previous scheduled end has passed, even if that ticket is still unpaid.
- A counter sale has no machine, contains items only, and is created and completed in one step.
- Start and completion times are set by the server, never by the client.

**Money and stock**

- Prices are copied from the price list in effect when a charge is added. Later price changes never alter existing tickets.
- Amounts are non-negative exact decimals.
- Stock cannot go negative. A sale that would exceed stock is rejected and the screen shows out of stock.
- A repeated reference number is allowed, because one transfer can cover several tickets. It appears in the data-quality panel.
- An amount paid that differs from the total is allowed and also appears in the data-quality panel.

**Roles**

- Staff can create tickets, edit any pending ticket, complete tickets and record counter sales. They can read machines, the price list, open tickets and current stock quantities (not unit costs).
- Staff cannot read reports, restock costs, utility rates, estimate assumptions or the audit log, and cannot void anything.
- Admin can do everything staff can, plus manage machines, prices, restocks, settings, users, reports and voids.
- Every ticket records created\_by and completed\_by from the signed-in account. All changes are written to the audit log.

## Metric definitions

Each EOD number is computed per business date from the staging layer. Voided tickets are excluded everywhere and shown in the data-quality panel.

| Metric | Definition | Date basis |
| --- | --- | --- |
| Jobs | Count of machine tickets, split wash and dry. Counter sales are counted separately. | Start date |
| Machine hours | Per machine: (base minutes + dry extension + extra-spin minutes) / 60 | Start date |
| Utilization | Machine hours / open hours (closing time minus opening time) | Start date |
| Electricity (kWh) | Wash: motor kW x load factor x hours. Dry: (element kW x duty factor for the level + motor kW) x hours. Extra-spin minutes count as washer motor time. | Start date |
| Water (litres) | Washers only: litres per cycle x the level's water factor (default 1.0). Extra spin adds none. | Start date |
| Utility cost | kWh x electricity rate + litres / 1,000 x water rate, using the rates in effect that day | Start date |
| Gross revenue | Sum of completed ticket totals, split into service and item revenue, with a breakdown by payment method | Completion date |
| Supplies cost | Units sold x weighted-average unit cost from restocks to date | Completion date |
| Operating expenses | Estimated utility cost + supplies cost | As above |
| Operating margin | Gross revenue - operating expenses, also as a percentage of gross. Labelled "before fixed costs". | As above |
| Pending at close | Count and value of tickets still unpaid at closing time. Never counted in gross. | Start date |

Two caveats print on the report itself: machine hours are scheduled hours, not measured ones, and electricity and water are estimates built from spec-sheet figures and editable assumptions.

The data-quality panel lists: payments where the amount paid differs from the total, repeated reference numbers, voids with their reasons, tickets pending for more than a day, and active machines with zero hours that day. A non-cash payment with no reference cannot occur, because completion requires one.

## Stack and repo layout

The stack is a React and TypeScript single-page app on Supabase, installable as a PWA, with the business rules living in Postgres.

- **Front end:** React, TypeScript and Vite. Tailwind and shadcn/ui for touch-friendly components, TanStack Query for server state, React Router, react-hook-form with Zod, and Recharts for admin charts.
- **Tablet first:** landscape layout designed first. The floor board is a tile grid that collapses to two columns on a phone, and admin tables become cards. A PWA install gives a full-screen app shell. There are no offline writes in v1; a connection indicator shows the state instead.
- **Back end:** Supabase Postgres and Auth. Row-level security enforces roles. Postgres functions handle every state change (create ticket, add add-on, complete, counter sale, void, restock). Plain SQL views form the staging and mart layers. Realtime on tickets keeps the floor board in sync across devices, with countdowns derived from server timestamps.
- **Generator and tests:** a seeded Python generator for the demo history, and SQL tests for constraints, roles, functions and views.
- **Hosting:** a static host such as Vercel, Netlify or Cloudflare Pages for the front end, and the Supabase free tier for the demo. Free-tier Supabase projects have historically paused after about a week idle, so the demo needs a scheduled keep-alive. Check the current limits when deploying.
- **Migrations:** versioned with the Supabase CLI, so a business deployment runs one command against its own database.
- **Rejected:** Next.js (server rendering adds complexity with no SEO need), React Native or Flutter (a PWA covers the use case), Firebase (not relational), Streamlit or Retool (they hide the engineering).

Repo layout:

- `/app`: the React app
- `/supabase`: migrations, policies, views, seed data
- `/tools/generator`: the Python data generator
- `/docs`: this design doc and later decision records

## Build order up to screens

Build in eight stages, each ending with a check that must pass before the next stage starts. Screens come last.

1. **Repo and environment.** Monorepo layout, local Supabase, migrations folder, and CI that applies every migration to a clean database. *Exit check:* an empty schema migrates in CI.
2. **Schema and constraints.** Tables, enums, indexes, check and exclusion constraints, and the lock-on-complete trigger. *Exit check:* SQL tests show each rule rejecting bad data (negative stock, overlapping runs, edits to a completed ticket, a non-cash completion with no reference).
3. **Auth and roles.** Profiles, a role helper and row-level security policies. *Exit check:* tests run as staff and as admin and confirm exactly what each can read and write, including that staff cannot read report views.
4. **Business functions.** Create ticket, add add-on, complete, counter sale, void and restock, each writing the audit log. *Exit check:* tests for every function, including price snapshots and each rule violation.
5. **Transformation views.** Staging run facts, then daily marts and data-quality checks. *Exit check:* on a small hand-built dataset the views return the numbers calculated by hand.
6. **Demo shop seed.** Fleet, price list, utility rates and settings as seed data. *Exit check:* a fresh database boots into a usable demo shop.
7. **Data generator.** Config and seed produce 90 days through the same constraints, plus the ground-truth file and self-checks. *Exit check:* two runs with the same seed give identical data, mart totals match the ground truth, and the data-quality views catch the planted anomalies.
8. **App shell.** Generated types, Supabase client, login, role-based routing, PWA shell and layout. *Exit check:* staff and admin land on different home screens, and the shell works at tablet and phone widths.

The screens follow, in the order listed in the next section.

## Screens

Twelve screens, listed in build order: the staff flow comes first because it creates the data every report reads. Ticket and stock writes go through the business functions in the build order. Admin setup screens write their own tables directly, under admin-only row-level security.

| Screen | Role | Reads | Writes |
| --- | --- | --- | --- |
| Floor board (home) | Staff, admin | machines, open tickets | none |
| New ticket | Staff, admin | machines, price\_list | tickets |
| Ticket detail (pending only) | Staff, admin | tickets, price\_list | tickets, audit\_log |
| Complete ticket | Staff, admin | tickets | tickets |
| Counter sale | Staff, admin | price\_list, stock balance | tickets |
| Machines | Admin | machines | machines |
| Price list | Admin | price\_list | price\_list |
| Settings | Admin | settings, utility\_rates | settings, utility\_rates |
| Inventory | Admin | stock balance | restocks |
| EOD report | Admin | daily marts, data-quality views | none |
| Ticket browser | Admin | tickets | tickets (void only) |
| Users | Admin | profiles | profiles |

The floor board shows each machine as free, running with time left, or done and awaiting pickup. "Done" is derived from the scheduled end, not stored.

## Synthetic history generator

A seeded Python generator writes 90 days of realistic history through the real schema and constraints. It also writes a ground-truth file, used to check the pipeline now and forecasts later.

**Demand model**

- Visit arrivals by hour: base rate x day of week x hour of day x payday x weather x trend x overdispersed noise.
- Open 08:00 to 21:00 (opening time assumed). The last start leaves the scheduled end at or before closing.
- Weekends are highest, Monday is elevated, midweek is lowest. Hours peak in the morning around 9 to 11, higher after work, and at midday on weekends.
- Payday lift on the 15th, the 30th and the day after each.
- Weather is a persistent rainy and dry sequence. Rain raises demand and shifts dryer levels up. One typhoon day is mostly closed. Holidays come from a Philippine holiday list in the config; Nov 1 and 2 are low.
- Trend: about 10 to 15 percent growth across the window, the signal a forecast should recover.
- Calibration: the base rate is set to hit target utilization, 35 to 40 percent on weekdays and 60 to 70 percent on weekends, with weekend peak hours saturating. That is about 110 machine tickets and 10 counter sales a day, roughly 10,000 tickets in total.

**Ticket behavior**

- A visit has one to three washes (about 65, 25 and 10 percent). Wash size is 8, 12 and 16 kg at about 50, 35 and 15 percent. Level is clean, cleaner and cleanest at about 50, 35 and 15 percent.
- A dry follows about 85 percent of washes (95 percent in rain) after a short lag, in a dryer of matching or larger size, leaning to drier and driest on rainy days.
- Add-ons: dry extension on about 15 percent of dry tickets, extra spin on about 8 percent, detergent on about 35 percent of washes, fabcon on about 25 percent.
- Each ticket takes a free machine of the right size. If none is free, the start is delayed, and a customer facing a long wait leaves. Walk-aways are never recorded as tickets, as in real data. The generator keeps them in the ground-truth file.

**Payments and staff**

- Payment mix of about 55 percent cash, 30 GCash, 8 Maya and 7 card (assumptions). Non-cash tickets get a unique, realistic-looking reference.
- Customers pay at pickup after a skewed lag. About 2 to 3 percent of tickets are still pending at close and complete the next morning.
- Three attendants work overlapping shifts, so created\_by and completed\_by sometimes differ.

**Stock and settings history**

- An opening restock, then top-ups every 7 to 10 days. Unit cost drifts up about 2 percent mid-window. One late restock causes a brief stockout.
- One dryer price increase mid-window and monthly electricity rate steps, so effective-dated prices and rates are exercised.

**Planted anomalies** (each logged in the ground truth with ticket ids)

- A small share of voids with reasons
- A few payments short or over by small amounts
- A handful of repeated reference numbers: legitimate split payments, plus one suspicious reuse
- One machine out of service for three days
- A couple of tickets left pending for more than a day
- The typhoon day

**Checks and loading**

- Key rules are table constraints and triggers, not only functions, so the generator can insert final-state rows directly and still cannot break them.
- The ground-truth file holds daily latent demand including walk-aways, the parameters used, and the anomaly list. It powers SQL tests and forecast backtests, such as holding out the last 14 days.
- One command reseeds the demo database from the config and a seed. The scheduled demo reset calls the same command.
- Self-checks after every run: no overlapping machine runs, stock never negative, payments only on completed tickets, and totals reconciling to the ground truth.

## Defaults

The demo shop has six washers and six dryers, placeholder prices and Philippine utility rates. The admin can edit every figure.

**Fleet**

| Machine | Count | Capacity (kg) | Motor (kW) | Heating element (kW) | Water per cycle (L) |
| --- | --- | --- | --- | --- | --- |
| Washer | 3 | 8 | 0.56 |  | 44 |
| Washer | 2 | 12 | 0.85 |  | 65 |
| Washer | 1 | 16 | 1.13 |  | 87 |
| Dryer | 3 | 12 | 0.37 | 7.8 |  |
| Dryer | 3 | 16 | 0.49 | 10.4 |  |

These values are scaled in proportion to capacity from Speed Queen's 9.5 kg coin-drop washer (0.67 kW motor, 51.8 L per cycle, per its [spec sheet](https://static.pcrichard.com/docs/FV6020WN_Specifications-Sheet_01.pdf)) and its 8.2 kg stack dryer pocket (5,350 W element at 240 V, 0.33 HP motor, per its [spec sheet](https://distribution.alliancelaundry.com/wp-content/uploads/2022/12/DL_AM21-0096_SpecSheet_SS_Electronic_en-US-1.pdf)). Scaling probably overstates the power of the larger dryers, so replace these with real spec sheets when available.

**Wash prices (PHP)**

| Level | Minutes | 8 kg | 12 kg | 16 kg |
| --- | --- | --- | --- | --- |
| Clean | 30 | 80 | 120 | 160 |
| Cleaner | 40 | 100 | 150 | 200 |
| Cleanest | 50 | 120 | 180 | 240 |

**Dry prices (PHP)**

| Level | Minutes | 12 kg | 16 kg |
| --- | --- | --- | --- |
| Dry | 30 | 90 | 120 |
| Drier | 45 | 135 | 180 |
| Driest | 60 | 180 | 240 |

**Add-ons and items (PHP)**

- Extra spin: 5 minutes, 15.
- Dry extension: 15 per 5 minutes on 12 kg, 20 per 5 minutes on 16 kg.
- Detergent: 15 per dose, cost 6. Fabric conditioner: 10 per dose, cost 4. Both are placeholders, and the least researched numbers here.

Only the 8 kg clean wash (80 PHP) falls within the roughly 50 to 80 PHP per load that one [LaundryAtlas guide](https://laundryatlas.com/blog/self-service-vs-full-service-laundry-philippines) gives for self-service washing. Every other wash price, and all the dry prices (against its 40 to 70 PHP per dry cycle), sit above that range, and the larger machines price higher by design. All prices are placeholders to be replaced with a real shop's price board.

**Utility rates**

| Rate | Default | Basis |
| --- | --- | --- |
| Electricity | 15.0615 PHP per kWh | Meralco's overall residential rate for October 2026, up from 14.7424 in September ([Daily Tribune](https://tribune.net.ph/2026/10/13/meralco-rate-hike-eats-into-october-bill-relief)). A commercial account will differ. |
| Water | 78.43 PHP per m3 | Maynilad west zone, sewered, from 1 July 2026. Without a sewer connection it is 67.58 ([Context.ph](https://context.ph/2026/06/04/maynilad-cuts-water-rates-starting-july-manila-water-fees-unchanges/)). |
| Water (alternative) | 85.06 PHP per m3 | Manila Water east zone, sewered, Q1 2026 all-in tariff. Unsewered is 67.98 ([Daily Tribune](https://tribune.net.ph/2025/12/15/higher-water-tariffs-set-for-metro-manila)). |

**Estimate assumptions (editable settings)**

- Washer load factor 0.7, dryer heating duty factor 0.6 for every level, water factor 1.0 for every level. All three are assumptions, not measurements.
- Opening time 08:00 and closing time 21:00.

Sanity check at these defaults: a 30-minute 12 kg dry uses about 2.5 kWh, roughly 38 PHP of electricity against a 90 PHP price. A 12 kg clean wash uses under 10 PHP of electricity and water against 120 PHP. Dryers, not washers, drive utility cost.

## Out of scope, phase 2 and open items

Version 1 stops at a working ticket flow, an honest daily report and a realistic demo. Everything else waits.

**Out of scope for v1:** fixed costs and true net profit, forecasting, customer tracking, online payment processing (payments are only logged), offline writes, multi-branch, notifications.

**Phase 2:**

- Multi-branch, with a branch level added to the data model.
- Customer tracking and repeat-drop-off prediction, such as a customer's regular large batch every two weeks.
- Forecasts: demand by hour, days of stock left, projected operating margin.
- An expenses log, so the report can show true net profit and a break-even point.

**Open items**

- [ ] Opening time: 08:00 is assumed.
- [ ] Optional customer name or phone at intake. It is a cheap hedge for the phase 2 repeat-customer feature, because data not captured now cannot be recovered later.
- [ ] Mistakes after creation: the default is an admin void and a new ticket. The alternative is letting staff correct machine, size or level while a ticket is pending.
- [ ] Real spec sheets for the 12 and 16 kg washers and dryers. The current defaults are scaled.
- [ ] A real Quicklean price board to replace the placeholder prices.
- [ ] Philippine retail and restock costs for detergent and fabric conditioner.
- [ ] The commercial electricity rate class, and the November 2026 Meralco rate.
- [ ] Values for the washer load factor and the dryer duty factor.

## Sources

Pages opened on 11 November 2026.

- [Meralco rate hike eats into October bill relief (Daily Tribune)](https://tribune.net.ph/2026/10/13/meralco-rate-hike-eats-into-october-bill-relief)
- [Maynilad cuts water rates starting July (Context.ph)](https://context.ph/2026/06/04/maynilad-cuts-water-rates-starting-july-manila-water-fees-unchanges/)
- [Higher water tariffs set for Metro Manila (Daily Tribune)](https://tribune.net.ph/2025/12/15/higher-water-tariffs-set-for-metro-manila)
- [Self-Service vs Full-Service Laundry in the Philippines (LaundryAtlas)](https://laundryatlas.com/blog/self-service-vs-full-service-laundry-philippines)
- [Speed Queen FV6 and DV6 specification sheet](https://static.pcrichard.com/docs/FV6020WN_Specifications-Sheet_01.pdf)
- [Speed Queen stack dryer specification sheet](https://distribution.alliancelaundry.com/wp-content/uploads/2022/12/DL_AM21-0096_SpecSheet_SS_Electronic_en-US-1.pdf)
