# Karsa — Changelog

## Stop 1 Fix (2026-10-17)

### Fixed
- **Card backgrounds**: `Card`, `Dialog`, `Popover`, `DropdownMenu`, `Select`, `Drawer`, `Toast`
  all now use `bg-secondary-background` (white) in their component className. The previous
  `@layer base` override in `globals.css` was ineffective because Tailwind utility classes
  (`@layer utilities`) override `@layer base`; fix moved to component level.
- **Chart bar colors**: replaced old palette (included `#EF4444` red — reads as "wrong answer",
  `#16A34A` green — reads as "correct", `#475569` dead gray) with bright Siang Tropis set:
  `#00C6D6` cyan, `#FFD93D` yellow, `#FF8FCB` pink, `#A78BFA` lavender, `#FB923C` orange,
  `#60A5FA` blue. No red, no green, no gray. Sharing hues with slide-type chips is acceptable
  (only one type is visible per view). Correct-answer marking uses icon + mint only.
  Updated: `globals.css`, `app/styleguide/page.tsx`, PRD §17.1–17.2.

### Added
- **Dot-grid page background**: subtle cream dot-grid on `body` via `radial-gradient`; never
  behind text that is not on a white card. Retained after Stop 1 correction review.
- **Card contrast Playwright spec** (`e2e/card-contrast.spec.ts`): runs inside the main e2e
  config (real backend, port 3100/3101). Asserts every visible `[data-slot="card"]` differs
  from the page body background. Proved: FAIL on `bg-background` (cream = page), PASS on
  `bg-secondary-background` (white ≠ cream).
- **Screenshot Playwright spec** (`e2e/ui-screenshots.spec.ts`): regenerates all
  `e2e/screenshots/after-stop1-fix/*.png` with `pnpm test:e2e:screenshots` against the real
  backend. Config `playwright.screenshots.config.ts` overrides `NEXT_PUBLIC_API_URL` so
  `.env.local` value is ignored.
- `uploads/` added to backend `.gitignore`.

### Config disclosure
`.env.local` has `NEXT_PUBLIC_API_URL=http://172.26.193.252:3001` which is NOT `localhost`.
The backend runs on `localhost:3001`. All session-based pages compiled by the dev server on
port 3000 cannot reach the backend. **Fix**: change `.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_ALLOWED_DEV_ORIGINS=localhost
```
Then restart `pnpm dev`. The screenshot config overrides this automatically (uses port 3105).

---

## Stop 2 (in progress)

See Stop 2 entries below as they land.
