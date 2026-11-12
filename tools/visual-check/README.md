# Visual check

The site in a real browser (Chromium, Pixel 7 screen), in light and dark mode, through the whole flow:
login screen → search and add → quick produce → **barcode scan with a fake camera** → change a section →
in-store mode → comparison → deals with store filter. Screenshots in `out/`.

How it works without a Google login: Supabase requests are intercepted and answered from a local Postgres
that runs the same migrations and functions, with RLS as a family member. The data = today's real prices.

```bash
# once per environment
./setup-local-db.sh            # local Postgres + migrations + real price ingest
python3 make-barcode.py        # out/barcode.y4m - a "camera" showing a barcode
npm install

# each check
(cd ../../web && npm run build && PORT=3100 npm run start &)
npm run light
npm run dark
```

Requires: Postgres 16, Playwright + Chromium (preinstalled in Claude cloud sessions), ffmpeg, Pillow.

## The bin scanner and notifications
```bash
npm run kiosk                  # scan at the bin -> "Ran out" tab -> to the list only by a click; a fixed device opens on /scanner

# The notification server (the real route handlers) against a fake Supabase + a fake HTTPS push service:
node mock-supabase.cjs &
openssl req -x509 -newkey rsa:2048 -nodes -keyout out/push-key.pem -out out/push-cert.pem -days 2 -subj "/CN=localhost"
(cd ../../web && NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 npm run build)
(cd ../../web && NODE_TLS_REJECT_UNAUTHORIZED=0 SUPABASE_SECRET_KEY=dummy VAPID_PRIVATE_KEY=<from your secrets> \
   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 PORT=3200 npm run start &)
node notify-api.cjs            # 9 checks: security, who gets what, duplicates, digests, baseline, cleaning dead devices
```
`NODE_TLS_REJECT_UNAUTHORIZED=0` is for the local test only (a self-signed certificate for the fake push service). Never in production.
After the test, rebuild normally (without `NEXT_PUBLIC_SUPABASE_URL`) before the visual check.
