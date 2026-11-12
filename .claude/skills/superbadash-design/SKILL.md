---
name: superbadash-design
description: The SuperBadash design system - colour tokens (light/dark), typography, components, RTL rules, Hebrew UX copy and a visual-check checklist. Use for ANY change to the site's UI in web/ (a new screen, component, colour, layout, wording) and before declaring UI work done.
---

# SuperBadash design system

The site is a family shopping tool: used on a phone, often with one hand, while walking down an aisle.
Every decision follows from that: **glanceable, calm, large tap targets, colour = meaning**.

## Principles
1. **Colour carries meaning, not decoration.** Green = action/good price. Orange = a deal (only!). If everything is coloured, nothing stands out.
2. **The content is the hero.** Product name and price are first in the hierarchy; everything else (nutrition, who added it, section) is secondary and smaller.
3. **Dark mode isn't an afterthought.** Most of the family uses the phone in dark mode. Every colour comes from a token that has a dark pair.
4. **Native RTL.** Hebrew is the source, not a translation. Directions are always logical (start/end), never left/right.
5. **Instant response.** Optimistic updates; no confirmation except for an action that moves many items (finishing a shop).

## Colour tokens (`web/src/app/globals.css`)
Defined as CSS variables with a light/dark pair, exposed to Tailwind through `@theme inline`.
**Use only these classes.** Never raw Tailwind colours (`slate-500`, `emerald-600`...) and never the `dark:` variant.

| Token | Usage | Tailwind classes |
|---|---|---|
| `bg` | page background | `bg-bg` |
| `surface` | card, input, dropdown | `bg-surface` |
| `surface-2` | secondary area: quantity button, chip, empty icon | `bg-surface-2` |
| `line` | borders and dividers | `border-line` |
| `fg` | main text | `text-fg` |
| `muted` | secondary text (section headings, details) | `text-muted` |
| `faint` | tertiary text (who added it, delete icon, placeholder) | `text-faint` / `placeholder:text-faint` |
| `brand` / `brand-strong` / `brand-fg` | primary action, the best price, the active tab | `bg-brand text-brand-fg active:bg-brand-strong`, `text-brand` |
| `brand-soft` | light background of the active state (nav pill) | `bg-brand-soft` |
| `accent` / `accent-soft` | **deals only** (🔥 badge, "real deal") | `bg-accent-soft text-accent` |
| `warn` / `warn-soft` | conditional, expiring soon, missing at a store | `text-warn`, `bg-warn-soft` |
| `danger` | delete, fake deal, error | `text-danger`, `bg-danger/15` |
| `info` / `info-soft` | guidance tips | `bg-info-soft text-info` |
| `img` | always white behind product photos (they're shot on white) | `bg-img` |

Allowed exceptions (fixed colours by meaning, not by theme):
- The official Nutri-Score colours in `NutritionChip.tsx`.
- The Ministry of Health red label in `ProductHealth.tsx` (`bg-[#d32f2f]` with white text): a regulated label that keeps its colour in both modes.
- Store identity colours in `lib/stores.ts` (dot / chart bar only, never as text on a background).
- The camera screens (`Scanner.tsx`, `Kiosk.tsx` = the fixed scanner by the bin): a camera UI that is always dark, in either mode
  (explicit `[#hex]` values only, so the guard stays strict).

Deal verdict → badge (`lib/pricing.ts` `VERDICT`): real=accent, conditional=warn, permanent=surface-2/muted, meh=info, fake=danger.

## Typography
Font: **Heebo** (`next/font/google`, variable `--font-heebo`), Hebrew + Latin.

| Role | Classes |
|---|---|
| App title | `text-lg font-extrabold tracking-tight` |
| Screen/section title | `font-semibold` (in Deals) or `text-sm font-bold text-muted` (section header in the list) |
| Product name | `font-semibold leading-snug line-clamp-2` |
| Body text | `text-base` (inputs are always ≥16px - otherwise iOS zooms in) |
| Details / meta | `text-xs text-muted` |
| Micro (who added it, footnotes) | `text-[11px] text-faint` |
| Prices / quantities | `tabular-nums`, format only through `ils()` → `₪3.90` |

## Shape and spacing
- Page: `px-4`, bottom padding `pb-28` (the bottom nav).
- Card: `rounded-2xl border border-line bg-surface p-3 shadow-card`.
- Input / primary button: `h-12 rounded-2xl`.
- Chip / filter / pill: `rounded-full`.
- Within a list: `space-y-2`. Between sections: `space-y-5`.
- Product image: 48px in the list, 40-44 in search/deals, `rounded-xl bg-img object-contain`.

## Components (copy these patterns)
```tsx
// Primary button
<button className="h-12 rounded-2xl bg-brand px-5 font-bold text-brand-fg shadow-card active:bg-brand-strong disabled:opacity-40">הוסף</button>
// Secondary button / pill
<button className="rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted">יציאה</button>
// Filter chip (role="tab" + aria-selected)
<button className={active ? "rounded-full border border-brand bg-brand px-3.5 py-1.5 text-sm font-medium text-brand-fg"
                          : "rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm font-medium text-fg"}>
// Section header
<h3 className="flex items-center gap-2 px-1 text-sm font-bold text-muted"><span className="text-base">🥛</span>חלב, גבינות וביצים<span className="rounded-full bg-surface-2 px-2 text-xs font-semibold">3</span></h3>
// Deal badge
<span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">🔥 מבצע ברמי לוי</span>
// Tip banner
<p className="rounded-2xl bg-info-soft p-3 text-sm text-info">...</p>
// Empty state: a large emoji + one warm sentence in text-muted, centred, py-16
```
Horizontal chip row: `no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4` (bleeds to the screen edge).

## RTL
- Only `ms-/me-/ps-/pe-/start-/end-/text-start/text-end`. Never `ml/mr/pl/pr/left/right/text-left/text-right`.
- The `<html dir="rtl" lang="he">` attribute is in `layout.tsx`. Don't add `dir` to individual components.
- Mixed numbers and Hebrew: write `₪` through `ils()`; don't build price strings by hand.

## Interaction and accessibility
- Tap target ≥ 40px (aim for 44). Icon-only buttons → `aria-label` in Hebrew. A small icon (a 28px circle, ×) sits
  inside a larger button with a negative margin (`-m-2 h-11 w-11`), so the layout doesn't grow and the tap target does.
- Never `text-white`/`bg-white`: on `bg-brand` the text is `text-brand-fg` (in dark mode brand is light green and the text is dark).
- Disabled state: `disabled:opacity-40`. Pressed state: `active:` (a phone has no hover).
- Optimistic update first, then the request to Supabase.
- Contrast: the tokens are tuned for AA. Don't put `text-faint` on `bg-surface-2` for important content.
- Long product names (from the price files: abbreviated, sometimes 40+ characters): always `line-clamp-2` or `truncate`,
  and always through `displayName()` (`lib/text.ts`), which separates digits from Hebrew letters ("הומוגני3% 1.5ל" reads like "71.5" in RTL).
- A number with a sign/percent inside Hebrew text: `<bdi dir="ltr">−37%</bdi>` - otherwise the minus moves to the other side.
- Store colours (`storeColor`): a dot or a bar only. "Best/cheapest" is shown in `brand`, an incomplete basket in grey (`bg-faint/40`)
  plus a `text-warn` label, so a partial basket doesn't look "cheap".

## UX copy
Short, warm, family Hebrew. Address the family in the plural ("סמנו", "הוסיפו"). No technical jargon ("RLS", "sync").
Explain *why* when it isn't obvious (e.g. "מבצע קבוע = זה המחיר האמיתי, אין סיבה להצטייד").

## Checklist before finishing UI work
1. Guard against hard-coded colours/directions (should return nothing except Scanner.tsx):
   ```bash
   grep -rnE "\b(slate|emerald|amber|rose|sky|gray|zinc|neutral|lime|green|red|blue)-[0-9]{2,3}|\b(text|bg|border)-(white|black)\b|\bdark:|\b(ml|mr|pl|pr|left|right)-[0-9]|text-(left|right)" web/src --include=*.tsx --include=*.ts | grep -v -E "Scanner.tsx|Kiosk.tsx"
   ```
2. `cd web && npm run lint && npm run build`.
3. Visual check in **both** modes: `tools/visual-check/README.md` (`npm run light` / `npm run dark`), then **look** at the screenshots in `tools/visual-check/out/`:
   - Is all text readable in dark mode? No white card on a dark background?
   - Are the name and price the first thing the eye sees?
   - Is orange only on deals?
   - Alignment is correct for RTL, and long names don't break the layout?
   - Empty / loading / error states look sensible?
4. For a deeper review: the `designer` agent (`.claude/agents/designer.md`).
