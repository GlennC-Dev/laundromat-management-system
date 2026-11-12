# Laundromat Management System

A web app for running one attendant-operated, Quicklean-style laundromat in the Philippines, and turning its tickets into clean daily numbers. A portfolio showcase first, a usable single-shop product second. Full scope, rules and build order: [`docs/design.md`](docs/design.md).

## Stack

React 19, TypeScript, Vite, Tailwind 4, shadcn/ui, TanStack Query, React Router, Supabase (Postgres, Auth, Realtime).

## Layout

- `src/` the app
- `supabase/migrations/` the database, owned by this repo
- `supabase/tests/database/` pgTAP tests
- `tools/generator/` seeded demo-history generator (later stage)
- `docs/` design doc

## Develop

```sh
bun install
cp .env.example .env     # then fill VITE_SUPABASE_PUBLISHABLE_KEY from `supabase status`
bun run db:start         # needs Docker
bun run dev              # http://localhost:8080
```

Other scripts: `typecheck`, `lint`, `test`, `build`, `db:reset`, `db:test`. CI runs the app checks and applies every migration to a clean database, then runs the pgTAP tests.
