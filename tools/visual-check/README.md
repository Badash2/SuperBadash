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
