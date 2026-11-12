# SuperBadash

A smart shopping list for the Badash family: price tracking (the Price Transparency Law) at stores in Netanya,
fake-promotion detection, and a family website. Full plan: `docs/ARCHITECTURE.md`.

## Structure
- `src/superbadash/`: Python. Ingesting price/promotion files, the deal engine (`deals.py`), CLI. Runs 3× a day in GitHub Actions.
- `supabase/migrations/`: DB schema + RLS (family only). Applied automatically by the `ingest-prices` workflow on push.
- `web/`: the site (Next.js 16 + Supabase, client-side; the security is RLS). Deployed to Vercel on every push to `main`.
- `tools/visual-check/`: visual check of the site in a browser (phone, light/dark) without a Google login.

## Rules
- **Any UI change:** follow the `superbadash-design` skill (tokens only, no `dark:`, logical RTL). Before finishing: lint, build,
  and the visual check in both modes. For an in-depth design review: the `designer` agent.
- Next.js 16 is different from what you know: read `web/AGENTS.md` and the docs in `web/node_modules/next/dist/docs/`.
- Python: `pytest` (also against Postgres with `TEST_DATABASE_URL`). The deal engine's rules are calibrated against real data;
  a change to them → a test in `tests/test_core.py`.
- Never put secrets (DATABASE_URL, Google client secret) in the code or the chat; they live in GitHub Secrets / Supabase.
