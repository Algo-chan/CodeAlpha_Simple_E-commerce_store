# Frontend design system

The Phase 3 foundation: tokens, primitives and the rules that keep the storefront
looking like one product rather than a pile of pages.

Everything here is real. Token names, values and breakpoints are quoted from
`frontend/styles/tokens.css`, and component names are the ones actually exported
by `frontend/js/components/`. Where a decision was deliberate, the reasoning is
recorded too — an unexplained token gets "fixed" by the next person who does not
know why it existed.

Related: [frontend-storefront.md](./frontend-storefront.md) covers how the
storefront composes these primitives, and [architecture.md](./architecture.md)
covers the layering underneath.

---

## 1. Principles

Four rules settle most styling arguments before they start.

1. **Tokens, not literals.** A component that hard-codes `#1a1a1a` or `14px` has
   opted out of the design system. If a value is not a token, either the token
   set is missing something or the value was arbitrary; both are worth fixing at
   the source rather than with `!important`.
2. **Mobile-first.** Base styles describe the small screen. Wider layouts are
   progressive enhancement in a `min-width` query. There are no `max-width`
   overrides, so there is no specificity war between the two.
3. **State is never colour alone.** Selected, disabled, sold out and low stock
   each carry a second signal — a check, a strike, a label, a border change —
   because roughly one man in twelve cannot separate the hues being used, and
   because a greyscale screenshot should still be readable.
4. **Restraint over decoration.** Whitespace and type do the work. There are no
   gradients on surfaces, no glassmorphism, and shadows are reserved for things
   that genuinely float above the page.

---

## 2. Colour

### 2.1 Palettes

Four raw ramps, defined once and referenced only through semantic tokens. A
component never reaches for a raw ramp value.

| Ramp        | Role                             | Steps                  |
| ----------- | -------------------------------- | ---------------------- |
| `--bone-*`  | Warm neutral canvas and surfaces | 50, 100, 200, 300, 400 |
| `--ink-*`   | Text, borders, dark surfaces     | 300–900                |
| `--ember-*` | **Primary** — the brand accent   | 50–800                 |
| `--moss-*`  | Success                          | 50, 500, 700           |
| `--amber-*` | Warning / low stock              | 50, 500, 700           |
| `--rust-*`  | Error / sold out / destructive   | 50, 500, 700           |
| `--azure-*` | Info                             | 50, 500, 700           |

`--white` and `--black` exist for the two cases a ramp cannot express: pure
overlay scrim and pure focus ring.

### 2.2 Semantic tokens

| Token                                           | Use                                         |
| ----------------------------------------------- | ------------------------------------------- |
| `--color-primary`                               | Primary buttons, active nav, price emphasis |
| `--color-primary-hover` / `-active`             | Interactive primary states                  |
| `--color-primary-subtle`                        | Tinted fills (badges, selected chips)       |
| `--color-primary-contrast`                      | Text on a primary fill                      |
| `--color-secondary`                             | Secondary emphasis, category accents        |
| `--color-accent`                                | Sparing editorial highlight                 |
| `--color-bg`                                    | Page canvas                                 |
| `--color-bg-subtle`                             | Alternating section band                    |
| `--color-surface`                               | Cards, panels                               |
| `--color-surface-muted`                         | Quiet cards, skeletons' base                |
| `--color-surface-sunken`                        | Wells, inset areas                          |
| `--color-surface-elevated`                      | Menus, popovers, drawers                    |
| `--color-surface-inverse`                       | Footer, announcement bar                    |
| `--color-text`                                  | Body text                                   |
| `--color-text-secondary`                        | Supporting copy                             |
| `--color-text-muted`                            | Captions, metadata                          |
| `--color-text-subtle`                           | Least important text                        |
| `--color-text-inverse` / `-muted`               | Text on dark surfaces                       |
| `--color-text-link`                             | Inline links                                |
| `--color-border`                                | Default hairline                            |
| `--color-border-subtle`                         | Dividers within a card                      |
| `--color-border-strong`                         | Inputs, emphasis                            |
| `--color-success` / `-bg` / `-border` / `-text` | In-stock, confirmations                     |
| `--color-warning` / `-bg` / `-border` / `-text` | Low stock                                   |
| `--color-error` / `-bg` / `-border` / `-text`   | Sold out, validation, removal               |
| `--color-info` / `-bg` / `-border` / `-text`    | Neutral notices                             |
| `--color-focus` / `--color-focus-ring`          | Focus indicator                             |
| `--color-overlay` / `-strong`                   | Scrims                                      |
| `--color-skeleton` / `--color-skeleton-sheen`   | Loading placeholders                        |

### 2.3 Status colours are paired, never alone

Every status token ships with a background, a border and a text variant. That is
what lets a low-stock badge be a tinted pill with a border and dark text rather
than orange text on white, which fails contrast and reads as an alert even when
it is not one.

---

## 3. Typography

Two families, loaded once, non-blockingly.

| Token            | Stack                               | Role                        |
| ---------------- | ----------------------------------- | --------------------------- |
| `--font-display` | Fraunces (variable, optical sizing) | Headlines, prices, wordmark |
| `--font-sans`    | Inter                               | Body, UI, labels            |
| `--font-mono`    | System mono                         | SKUs, order numbers         |

A serif display against a neutral sans is the storefront's main voice
distinction: it is what stops the page reading as a generic template. It is
loaded from Google Fonts with `media="print"` + `onload` swap plus a `<noscript>`
fallback, so text is never invisible waiting on the network.

### 3.1 Scale

| Token              | Size      | Used for                        |
| ------------------ | --------- | ------------------------------- |
| `--font-size-3xs`  | 0.625rem  | Legal, superscripts             |
| `--font-size-2xs`  | 0.6875rem | Micro-labels                    |
| `--font-size-xs`   | 0.75rem   | Captions, metadata, helper text |
| `--font-size-sm`   | 0.875rem  | Secondary UI, footer links      |
| `--font-size-base` | 1rem      | Body                            |
| `--font-size-md`   | 1.0625rem | Lead paragraphs                 |
| `--font-size-lg`   | 1.25rem   | Card titles                     |
| `--font-size-xl`   | 1.5rem    | Section sub-headings            |
| `--font-size-2xl`  | 1.875rem  | Section headings                |
| `--font-size-3xl`  | 2.25rem   | Page titles                     |
| `--font-size-4xl`  | 3rem      | Hero                            |
| `--font-size-5xl`  | 4rem      | Hero, large desktop only        |

### 3.2 Weight, line height, tracking

- Weights: `--font-weight-regular` 400, `-medium` 500, `-semibold` 600, `-bold` 700.
  The storefront uses 400/500/600 for almost everything; 700 is reserved for
  prices and the wordmark, so bold actually means something.
- Line heights: `--line-height-none` 1, `-tight` 1.15, `-snug` 1.3, `-base` 1.6,
  `-relaxed` 1.75. Headings take `-tight`/`-snug`, body takes `-base`.
- Tracking: `--letter-spacing-tighter` … `--letter-spacing-widest`, plus
  `--text-transform-label` for small-caps eyebrow labels.

### 3.3 Reading measure

`--content-measure` caps prose at a comfortable line length. Body copy outside a
card is expected to use it; the helper class `.text-measure` applies it.

---

## 4. Spacing

A 4px-based scale, with `3xs`/`2xs` for the small optical corrections.

| Token                         | Step                                   |
| ----------------------------- | -------------------------------------- |
| `--space-3xs` … `--space-5xl` | 0.25rem → 6rem                         |
| `--space-stack-xs` … `-xl`    | Vertical rhythm inside a component     |
| `--space-section`             | Vertical padding between page sections |
| `--space-section-sm` / `-lg`  | Tighter / looser section rhythm        |
| `--gutter-xs` / `-sm` / `-md` | Grid gutters by breakpoint             |
| `--grid-gap-xs` … `-xl`       | Grid gaps by density                   |

`--space-section` is the default section rhythm and the first thing to reach for
when a page feels either cramped or cavernous. Changing it re-rhythms the whole
storefront at once, which is the point of having it.

---

## 5. Layout

| Token                                    | Value          | Meaning                   |
| ---------------------------------------- | -------------- | ------------------------- |
| `--container-max`                        | 90rem (1440px) | Content width             |
| `--container-max-narrow`                 | 68rem (1088px) | Editorial / reading width |
| `--container-pad`                        | fluid gutter   | Base page padding         |
| `--filter-sidebar-width`                 | 16rem          | Desktop filter rail       |
| `--mobile-nav-width`                     | —              | Mobile drawer width       |
| `--drawer-width` / `--drawer-width-lg`   | —              | Cart drawer               |
| `--quickview-width`                      | —              | Quick view panel          |
| `--toast-width`                          | —              | Toast region              |
| `--control-height-sm` / `-` / `-lg`      | —              | Buttons and inputs        |
| `--touch-target`                         | 2.75rem (44px) | Minimum interactive size  |
| `--product-media-ratio`                  | 4 / 5          | Product page media        |
| `--product-card-media-ratio`             | 1 / 1          | Card media                |
| `--header-height` / `--header-height-md` | —              | Sticky header offset      |

### 5.1 Breakpoints

| Token              | Value | Range                              |
| ------------------ | ----- | ---------------------------------- |
| `--breakpoint-sm`  | 30em  | 480px — large mobile               |
| `--breakpoint-md`  | 48em  | 768px — tablet                     |
| `--breakpoint-lg`  | 64em  | 1024px — laptop; nav switches here |
| `--breakpoint-xl`  | 80em  | 1280px — desktop                   |
| `--breakpoint-2xl` | 90em  | 1440px — large desktop             |

Breakpoints are where the layout **changes**, not where it merely grows. Two
that matter most:

- **64em** is where the header swaps the inline nav for the compact bar plus a
  menu button, and where the collection page moves its filters from a bottom
  sheet into a sidebar rail.
- **90em** is where the grid gains its fourth column and full gutters.

### 5.2 Grids

- Product grid: 2 columns on mobile, 2–3 on tablet, 4 on desktop. Columns are
  `auto-fit`/`minmax()` with a floor rather than a fixed count, so a wide screen
  gains columns without a narrow screen ever overflowing.
- Card media holds a fixed aspect ratio via `--product-card-media-ratio`, which
  is what keeps a grid's rhythm steady when image heights would otherwise vary.
  Images use `object-fit: cover`, never `fill`, so nothing is stretched.

---

## 6. Borders, radius, shadows

| Token                            | Use                               |
| -------------------------------- | --------------------------------- |
| `--radius-none` … `--radius-3xl` | 0 → 1.5rem                        |
| `--radius-full`                  | Pills, swatches, avatars          |
| `--border-width-hairline`        | Default 1px divider               |
| `--border-width-thick`           | Emphasis, focus, selected control |
| `--shadow-none`                  | Flat                              |
| `--shadow-subtle`                | Resting card                      |
| `--shadow-card`                  | Raised card, hover                |
| `--shadow-elevated`              | Menus, popovers, sticky header    |
| `--shadow-modal`                 | Modal and drawer                  |
| `--shadow-inset`                 | Wells, pressed states             |

Radius is used sparingly on purpose. Inputs and buttons are `--radius-sm`/`-md`,
cards `--radius-lg`, and only badges, swatches and pills go fully round. A page
of `--radius-2xl` rectangles reads as a template; the storefront uses roundness
to mark _kind_ of thing, not to decorate.

Shadows are for elevation only. A card at rest uses `--shadow-subtle` or none,
and gains `--shadow-card` on hover — a resting shadow strong enough to notice is
a shadow doing the job of a border.

---

## 7. Motion

### 7.1 Durations and easings

| Token                | Value | Use                                   |
| -------------------- | ----- | ------------------------------------- |
| `--duration-instant` | 90ms  | Press feedback, colour changes        |
| `--duration-fast`    | 160ms | Hover, focus, small reveals           |
| `--duration-normal`  | 240ms | Drawers, dropdowns, toasts            |
| `--duration-slow`    | 360ms | Modal panels, larger transitions      |
| `--duration-slower`  | 520ms | Reserved for deliberate reveals       |
| `--ease-standard`    | —     | The default                           |
| `--ease-enter`       | —     | Things arriving                       |
| `--ease-exit`        | —     | Things leaving (faster than entering) |
| `--ease-out` / `-in` | —     | One-directional                       |
| `--ease-emphasized`  | —     | Hero and section reveals              |

Exit is faster than entry by design: a shopper who dismissed something is done
with it, and a slow dismissal is felt as lag.

Named transitions compose these so components stay consistent:
`--transition-control`, `--transition-surface`, `--transition-overlay`,
`--transition-fade`.

### 7.2 What animates

Hero entrance, product image cross-fade, drawer/sheet slide, modal scale-and-
fade, toast entry, wishlist fill, cart badge pulse, dropdown reveal, skeleton
sheen, and `[data-reveal]` section entrances (IntersectionObserver, one-shot).

### 7.3 What does not

No parallax, no floating decorative objects, no scroll-jacking, no page
transitions. Animation may confirm an action or explain a change of state;
anything that delays shopping is a bug. `--duration-slow` is already the ceiling
for anything routine.

### 7.4 Reduced motion

`prefers-reduced-motion: reduce` collapses every duration token to `1ms` in one
block at the end of `tokens.css`. Because the tokens are the only place durations
are defined, that single override removes motion everywhere — including
third-party or later-added styles that use the tokens correctly. Transform-based
movement is neutralised separately in `animations.css`, since collapsing a
duration does not stop a `translate` from being applied.

---

## 8. Z-index

| Token           | Value | Layer                                 |
| --------------- | ----- | ------------------------------------- |
| `--z-base`      | 0     | Content                               |
| `--z-raised`    | 10    | Hovered cards, sticky table headers   |
| `--z-sticky`    | 100   | Sticky sub-headers                    |
| `--z-header`    | 200   | Site header                           |
| `--z-dropdown`  | 300   | Nav dropdowns, mega menu              |
| `--z-scrim`     | 400   | Overlay backdrop                      |
| `--z-drawer`    | 500   | Cart drawer, mobile nav, filter sheet |
| `--z-modal`     | 600   | Quick view, dialogs                   |
| `--z-sheet`     | 650   | Mobile bottom sheets                  |
| `--z-toast`     | 700   | Toasts                                |
| `--z-skip-link` | 800   | Skip link, above everything           |

The gaps are wide on purpose. Nothing is allowed to sit between two of these
numbers; a component that needs "just above the header" picks the token and
accepts the ordering.

---

## 9. Component primitives

Reusable, context-agnostic, and each one owns its own markup.

### 9.1 Buttons — `js/components/ui/button.js`

Variants: `primary`, `secondary`, `outline`, `ghost`, `danger`, plus `icon` for
square icon-only controls. Options: `size`, `block`, `loading`, `icon`,
`iconEnd`, `href` (renders an anchor styled as a button).

Every variant implements `hover`, `focus-visible`, `active`, `disabled` and
`loading`. Loading swaps the label for a spinner, sets `aria-busy`, and keeps the
button's width so the layout does not jump.

### 9.2 Form fields — `js/components/forms/field.js`, `choice.js`, `stepper.js`

- `field()` — label, input, helper text, error message, `aria-describedby`
  wiring, `aria-invalid`, focus management on failure.
- `choice()` — a radio or checkbox rendered as a swatch, button, chip or row
  depending on the control type.
- `stepper()` — quantity with decrement/increment and live value announcement.

States: default, focus, filled, disabled, invalid, loading.

### 9.3 Feedback — `js/components/feedback/`

- `toast.js` — stacked, auto-dismissing, manually dismissible, `role="status"`
  region, optional single action (used for "Added to cart" + Undo).
- `skeleton.js` — `ProductCardSkeleton`, `ProductPageSkeleton`,
  `SearchSkeleton`, `CartSkeleton`. Each mirrors the real component's geometry,
  so nothing reflows when content lands.
- `states.js` — empty and error states. Every one answers two questions: what
  happened, and what to do next. Error states offer a retry where retrying could
  work and never surface a stack trace.
- `overlay.js` — the shared primitive behind modal, drawer, bottom sheet,
  dropdown and popover.

### 9.4 Overlay primitive

`overlay.js` gives every floating surface the same behaviour, because
re-implementing it five times is how five subtly different focus traps end up in
one codebase:

- Escape closes.
- Click outside closes where that is appropriate (a modal scrim yes; a dropdown
  opened from a trigger no).
- Focus is trapped while open and restored to the trigger on close.
- Background scroll is locked, with scrollbar width compensated so the page
  behind does not shift.
- Focus is moved into the panel on open, and the panel is announced.

**Mobile adaptation is part of the contract, not a separate component.** The cart
drawer, mobile nav, filter panel and quick view are one implementation each: a
side panel on desktop, a bottom sheet or full-screen panel on mobile, chosen by
breakpoint.

---

## 10. Accessibility

- Semantic elements first. `button` for actions, `a` for navigation, `nav`,
  `header`, `main`, `footer`, `section` + `aria-labelledby`.
- One `h1` per page, no level skipped.
- Visible focus on everything interactive, via `--color-focus-ring`. Focus is
  never removed, only restyled.
- Icon-only controls carry `aria-label`; decorative icons are `aria-hidden`.
- State changes a screen reader must hear go through a live region: cart count,
  wishlist toggle, filter result count, form errors, toasts.
- Keyboard shortcuts (`/` for search, `c` for cart) are suppressed while a text
  field has focus.
- Colour is never the only signal (see principle 3).
- Motion respects `prefers-reduced-motion` (see 7.4).
- Target size is at least `--touch-target` (44px) on touch.

---

## 11. Mock-data architecture

The fixtures in `frontend/js/mock/` mimic the Phase 2 schema and the future API
response, so components never change when the real client arrives.

| File            | Role                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `products.js`   | Product, variant, inventory and review rows — snake_case, as in the database   |
| `categories.js` | Category rows plus `buildTree()`                                               |
| `media.js`      | Generated SVG imagery per product and angle                                    |
| `view.js`       | `buildCatalogue()` — the **only** place a row becomes a view model             |
| `api.js`        | `createMockClient()` — same method names and `{ data }` shape as `core/api.js` |

`view.js` is the important one. It is where the storefront's rules about the
domain live, and it is pure and synchronous so the whole catalogue can be built
in a test with no network:

- Only `status = 'ACTIVE'` products are listable (`is_listable`).
- Prices live on **variants**, never on the product. The product exposes
  `price_min_minor` / `price_max_minor` derived from its active variants, and an
  inactive variant can influence neither.
- `attributes` is untyped JSONB, so the attribute shape differs per category.
  Nothing assumes colour + size.
- A variant with no inventory row is digital and untracked, not broken. Such a
  product gets a synthetic purchasable variant so it can still be sold.
- Availability is `quantity - reserved_quantity`.
- Badges are capped at two, and sold out always wins the first slot.

### 11.1 Dataset coverage

Enough spread that every state can be reviewed on a page: 14 categories across
4 roots and 3 levels, 14 products (12 physical, 2 digital), 33 variants across
attribute shapes including `color+size`, `size`, `storage`, `color+ram+storage`
and none at all, 3–5 images per product with front/side/back/detail/lifestyle
angles, ETB 850–92,000, and in-stock, low-stock and sold-out examples. Products
carry `is_featured`, `is_new` and `display_order` as merchandising metadata —
deliberately editorial, with no invented sales figures.

### 11.2 Swapping in the real API

`app.js` imports `mockApi` from `mock/api.js` and passes it to components as
`api`. Both clients expose `getCatalogue`, `getProduct`, `searchProducts` and
`getFacets`, and both return normalised view models. Replacing the mock is a
change to that one import plus the catalogue load in `boot()`.

---

## 12. Conventions

- **No build step.** Pages load `/styles/main.css` and one ES module. No bundler,
  no transpiler, no framework. If a dependency is needed, first ask whether ~20
  lines of vanilla JS would do.
- **One component per file**, named for what it renders. A component that needs
  to know which page it is on is two components.
- **Markup is built in JS**, not fetched as HTML partials, because the header,
  cart badge and drawers are reactive and server-rendered partials would drift
  across five pages.
- **Events are delegated** at the container wherever a list can grow, and cleaned
  up on `destroy()`. The shell registers every teardown and runs it on
  `pagehide`.
- **Comments explain why, not what.** A comment restating the code is noise; a
  comment recording the bug that motivated the line is the thing that stops it
  coming back.
