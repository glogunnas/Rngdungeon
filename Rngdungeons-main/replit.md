# Procedural Room Generator

An atlas-driven room generator mockup that assembles floors, halls, water, stairs, and surrounding walls from the supplied 32×32 tileset.

## Run & Operate

- `pnpm --filter @workspace/room-generator run dev` — run the canonical web app locally
- `pnpm --filter @workspace/api-server run dev` — run the API server when backend work is needed
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/room-generator run build` — build the web app for production
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- The managed web artifact supplies `PORT` and `BASE_PATH` automatically.
- The API server requires `DATABASE_URL` — a Postgres connection string — when database-backed routes are used.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/room-generator/src/components/FirstGeneratedRoom.tsx` — canonical web app room layouts, tile classification, and wall/floor generation
- `artifacts/room-generator/public/images/tileset/` — atlas PNGs and labels used by the web app
- `lib/api-spec/openapi.yaml` — API contract
- `lib/db/src/schema/` — Drizzle schema source

## Architecture decisions

- Floor cells remain walkable tiles; boundary walls are emitted into adjacent void cells so narrow halls do not turn into walls.
- Perspective wall pieces are restricted to outside top edges; thin caps and side pieces are used for the other boundaries.
- Corner pieces are derived from diagonal footprint neighbors and are optional per layout.
- The preview keeps the supplied tile IDs and native 32×32 rendering for atlas fidelity.

## Product

The current product surface is a deterministic visual room-generation preview with multiple layouts, optional irregular corners, connected hall strips, water pockets with bridges, and stairs.

## Gotchas

- The canvas mockup is retained as a design reference; the user-facing product is the `Room Generator` web artifact at `/`.
- The API scaffold currently has only `/api/healthz`; its database schema is intentionally empty.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
