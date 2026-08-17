---
name: TypeScript typing patterns for this repo
description: Root causes and fix patterns behind the 167-error TypeScript cleanup — db typing, rhf generics, express Response shadow.
---

- The biggest implicit-`any` cascades came from `db` being declared `any` in `server/db.ts`. Keep it typed as `NodePgDatabase<typeof schema> | NeonDatabase<typeof schema>`; never revert to `any` — it silently untypes every query in the codebase.
- react-hook-form 7.55 + @hookform/resolvers 3.10 leave `Control`'s third generic unsubstituted. Pattern: local `const schema = ...; type FormValues = z.infer<typeof schema>` then `useForm<FormValues, unknown, FormValues>(...)` and type `onSubmit` with `FormValues`.
- `server/routes.ts` must import `Response` (and `NextFunction`) from `express`, or the DOM Fetch `Response` global wins and every handler fails overload resolution.
- tsconfig has `"target": "ES2022"` on purpose (matches bundler output); removing it re-breaks Set iteration and block-scoped function declarations.
- Zod: calling `.omit({ key: true })` for a key the schema doesn't have collapses the inferred type; only omit keys that exist.
- Known pre-existing test failures (not regressions): `opportunity-contacts-api.test.ts` (dev DB missing `opportunity_contacts` table — migration drift) and the external-lead concurrency-dedupe test (fails on clean baseline too).
