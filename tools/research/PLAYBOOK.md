# The research round: instructions for the Claude session

The goal: complete information for products that the family asked about ("search for me in the next round") or photographed:
ingredients, nutrition values, processing level, and reviews from the web. The results show up in the product card on the site.

## Steps
1. `python3 tools/research/research.py pending --out /tmp/research`
   If there's nothing pending, finish with a single line ("no requests").
2. For each product in `/tmp/research/manifest.json`:
   - **Look at the images** (Read on the files in `/tmp/research/<code>/`): `family_*` = what the family uploaded, `off_*` = Open Food Facts.
     Find the ingredient list and the nutrition-values table. Copy the ingredients **exactly** as written (Hebrew), don't paraphrase.
   - If there are no images, or the ingredients aren't readable: a web search (WebSearch) for the product name + "רכיבים" / "ערכים תזונתיים".
     Use only a source that clearly refers to the same product (name, manufacturer, size). Prefer the manufacturer's website.
   - **Reviews:** a web search for reviews of the product (Hebrew and English). Summarise in 1-2 sentences only what sources actually said,
     with links. If there is a numeric rating - `reviews_score` (0-5) and `reviews_count`. **Don't invent:** if nothing is found, write that in `note`.
   - Fill in:
     - `ingredients_text`, `ingredients_n` (the number of top-level ingredients), `additives` (E numbers / Hebrew names: stabiliser, emulsifier...)
     - `processing`: `minimal` (1-2 basic ingredients), `processed`, `ultra` (additives / many industrial ingredients)
     - `nutrition` per 100g/ml: `{kcal, protein, fat, sat_fat, carbs, sugars, fiber, sodium_mg}` - only what appears
     - `reviews_summary`, `reviews_score`, `reviews_count`, `review_sources` [{title, url}]
     - `sources`: where each piece of data came from (e.g. "family photo", "OFF image", a URL)
3. Write `/tmp/research/results.json` in the format:
   `[{"code": "...", "status": "done"|"failed", "note": "a short summary for the family", "research": {...}}]`
   `failed` = nothing reliable found (explain in the note what's missing - e.g. "a photo of the ingredient list is needed").
4. `python3 tools/research/research.py save /tmp/research/results.json`
5. Finish with a short summary: how many products, what was found, what's missing.

## Rules
- Reliability above everything: better "not found" than a guess. Nutrition values only from an image or a source about the exact product.
- Don't change anything else in the database or in the repo.
