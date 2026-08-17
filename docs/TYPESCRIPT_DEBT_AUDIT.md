# TypeScript Debt Audit — Baseline Inventory

**Date:** 2026-08-17 · **TypeScript:** 5.6.3 · **Command:** `npx tsc --noEmit`
**Baseline:** **167 errors** (raw output preserved during remediation at `/tmp/tsc-baseline.txt`).

## Distribution by error code

| Code | Count | Description |
|---|---|---|
| TS7006 | 86 | Implicit `any` on callback parameters |
| TS2322 | 41 | Type assignment mismatches |
| TS2769 | 13 | No overload matches (Express route handlers) |
| TS2538 | 6 | Type used as index type |
| TS2349 | 4 | Expression not callable |
| TS2345 | 4 | Argument type mismatch |
| TS2802 | 3 | Set/iterator downlevel iteration |
| TS2353 | 3 | Unknown object literal property |
| TS1252 | 3 | Function declaration in strict-mode block |
| TS7031 | 1 | Implicit `any` in binding element |
| TS2820 | 1 | String literal type mismatch |
| TS2552 | 1 | Cannot find name (`NextFunction`) |
| TS2430 | 1 | Interface extends incorrectly |

## Distribution by file

| File | Errors |
|---|---|
| `server/analytics-service.ts` | 49 |
| `server/routes.ts` | 30 |
| `client/src/pages/opportunity-detail-page.tsx` | 25 |
| `server/lead-gen-routes.ts` | 13 |
| `server/seed.ts` | 12 |
| `client/src/pages/activities-page.tsx` | 12 |
| `server/db.ts` | 9 |
| `client/src/pages/activity-detail-page.tsx` | 9 |
| `server/lead-gen-agent-service.ts` | 3 |
| 5 miscellaneous files | 5 |

## Root-cause groups, risk, and remediation order

| Group | Root cause | Errors | Risk | Fix |
|---|---|---|---|---|
| D | No explicit `target` in tsconfig → downlevel iteration + strict-block function checks | 6 (TS2802, TS1252) | Low | Add `"target": "ES2022"` (tightening; matches what Vite/esbuild already emit) |
| A | `let db: any` in `server/db.ts` erased Drizzle result types, cascading implicit-`any` into every `.map/.reduce/.filter` callback across server services | 87 (TS7006/TS7031) | Low | Type `db` as `NodePgDatabase<typeof schema> \| NeonDatabase<typeof schema>`; fix the surfaced insert/update mismatches without changing behavior |
| C | Express `Response` shadowed by DOM Fetch `Response`; `NextFunction` unimported | 17 (TS2769/TS2349/TS2552) | Medium | Import `Response`/`NextFunction` from `express` |
| B | react-hook-form 7.55 + @hookform/resolvers 3.10 leave `Control`'s third generic unsubstituted | ~30 | Medium | `useForm<FormValues, unknown, FormValues>()` with a local `z.infer` type; type `onSubmit` accordingly |
| F | `Date \| null` (Drizzle) vs `Date \| undefined` (form defaults) | ~8 | Low | Align zod form schema nullability with DB types |
| G | Isolated one-offs (enum case typo, stale mock fields, `Omit` interface drift, partial payloads) | 9 | Low | Individual self-contained fixes |

**Order executed:** D → C/E imports & hoists → A (db typing) → C remainder → B → F → G.
