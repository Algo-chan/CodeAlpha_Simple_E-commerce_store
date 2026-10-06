# Frontend storefront

How the customer-facing storefront is put together, what state it keeps, and
where the real backend plugs in.

Design tokens and primitives are documented separately in
[frontend-design-system.md](./frontend-design-system.md); this document covers
composition, state and the seams that Phase 5+ will fill.

**Current state: no backend calls.** Every product, category, price and image
comes from `frontend/js/mock/`. Cart and wishlist persist to `localStorage`.
Authentication, checkout, orders and payments are not built.

---

## 1. Shell

`js/app.js` is the only entry point. Every HTML page ends with:

```html
<script type="module" src="/js/app.js" data-page="home"></script>
```

and `data-page` selects one module from `js/pages/`, which is dynamically
imported. A shopper on the collection page never downloads the product page.

What is shared, and what a page owns:

| Shared by the shell                             | Owned by the page module                   |
| ----------------------------------------------- | ------------------------------------------ |
| Stores (cart, wishlist, catalogue, filters, UI) | Exactly one thing: filling `#main-content` |
| Header, footer, mobile nav                      | The page's own sections                    |
| Cart drawer, quick view, search overlay         | Its own skeletons and error states         |
| Toasts, global shortcuts, reveal-on-scroll      | Teardown of its subscriptions              |

The shell is built in JavaScript rather than from HTML partials for one
reason: **the header and cart badge are reactive**. They subscribe to the cart
store, so adding from a card three components away updates the badge
immediately. Server-rendered partials cannot do that, and duplicating the
header across five HTML files guarantees the copies drift.

### 1.1 Boot order

1. Toast region is mounted first — an "added to cart" can be raised while the
   shell is still building and needs somewhere to appear.
2. The catalogue is awaited **before** the header renders, because navigation is
   built from the category tree and rendering it twice causes a visible
   re-layout.
3. The shell renders even if the catalogue failed. A storefront with no
   navigation and no footer is a dead end; the page states what went wrong in
   place and offers a retry.
4. `cart.reconcile()` runs once the catalogue exists, so a basket restored from
   storage cannot quote a stale price or quantity.

---

## 2. Pages

| Page       | File                     | Route              |
| ---------- | ------------------------ | ------------------ |
| Home       | `js/pages/home.js`       | `/`                |
| Collection | `js/pages/collection.js` | `/collection.html` |
| Product    | `js/pages/product.js`    | `/product.html`    |
| Cart       | `js/pages/cart.js`       | `/cart.html`       |
| Wishlist   | `js/pages/wishlist.js`   | `/wishlist.html`   |

URL state on the collection page round-trips: `?q=`, `?category=`, `?sort=`,
`?sale=1`, `?stock=1` seed the filter store on load and are written back as the
shopper changes facets, so any view is linkable.

The URL is treated as a **complete** description of the query, not a patch. That
matters in both directions: a reload of `/collection.html?q=wool` keeps the term,
and clicking "All products" clears it. Patching only the parameters that happen
to be present — while the filter store persists facets on purpose — produced the
inverted bug where a page titled "All products" showed one product, because the
stale term came back from storage.

Writes use `replaceState`, not `pushState`: otherwise every keystroke in a price
field would become a history entry the shopper has to walk back through. The back
button therefore leaves the collection page rather than stepping through each
filter tweak, which is the behaviour a shopper expects from a filter panel.

Unknown values fall back to defaults rather than rendering an empty page: an
unrecognised `sort` is ignored, and an unresolvable `category` slug leaves the
category unset. Two facets are session-only for now — attribute and price ranges
are not yet URL-expressible — and page number always restarts, because a restored
page 3 of a smaller result set renders an empty grid.

---

## 3. Homepage architecture

The page is a composition of sections, each a local function returning one
element. No static markup, so nothing can drift from the catalogue.

```
Announcement bar          js/components/layout/announcement.js
Header (sticky)           js/components/layout/header.js
─────────────────────────────────────────────────────────────
Hero                      pages/home.js  hero()          split layout + product collage
Shop by category          pages/home.js  categoryGrid()  from the category tree
Featured this week        pages/home.js  (productGrid)   is_featured
New arrivals              pages/home.js  newArrivals()   is_new, date-ordered
Editor's picks            pages/home.js  popular()       display_order rank
Editorial band            pages/home.js  featureBand()   large image + copy
How it works              pages/home.js  steps()
Guarantees                pages/home.js  trustStrip()    anchored from the footer
Newsletter                pages/home.js  newsletter()    honestly inert
─────────────────────────────────────────────────────────────
Footer                    js/components/layout/footer.js
```

Section order is deliberate: promise, browse, featured, new arrivals, picks,
story, how it works, guarantees, newsletter. Someone who bounces at the fold
still gets the brand; someone who wants to shop gets categories above the fold
and products one scroll later.

Sections paint their own skeletons first and subscribe to the catalogue
afterwards. The catalogue is already loaded by the shell, so no notification is
coming to replace the placeholders — the grid is handed its products directly.

### 3.1 Component reuse

`ProductCard` knows nothing about the page it is on. It takes a product and
configuration, and is used unchanged by:

- the homepage featured grid and the two product rails,
- the collection page grid and list view,
- search results,
- the wishlist page,
- "related" and "you might also like" rails on the product and cart pages.

Same for the price block, rating, badge, wishlist button and quick-view trigger.
There is exactly one implementation of each; the homepage does not have its own
card.

### 3.2 Editorial honesty

"Editor's picks" is ranked by the hand-set `display_order` on each mock product,
and the section says so. There is no order history behind it, so the storefront
does not claim products are "bestsellers" or "10,000 people bought this". The
same applies to the guarantees strip: every claim there is configuration in
`home.js`, easy to correct when the real policies are settled.

---

## 4. Frontend state

No state library. `js/state/store.js` is ~90 lines of observable store, and the
rest of `js/state/` is thin domain logic on top of it.

| Store               | Responsibility                                                                 |
| ------------------- | ------------------------------------------------------------------------------ |
| `store.js`          | The primitive: immutable updates, batched notification, selectors, persistence |
| `catalogue.js`      | Products, categories, lookups, merchandising selectors, facets                 |
| `cart.js`           | Lines, quantities, totals, availability                                        |
| `wishlist.js`       | Saved product ids                                                              |
| `filters.js`        | Facet state plus the pure `filterProducts`/`sortProducts`/`queryProducts`      |
| `ui.js`             | Drawer/modal visibility, toasts                                                |
| `search-history.js` | Recent searches                                                                |

### 4.1 Store contract

1. State is **replaced, never mutated** — every update produces a new object, so
   `prev !== next` always holds for subscribers.
2. Notifications are **batched into one microtask**, using a stable per-store
   handle so repeated updates in a tick collapse into a single render pass.
3. A subscriber that **throws is logged and skipped** — one broken card cannot
   take down the cart badge.
4. **Selectors** are plain functions memoised on a state reference check, so a
   component can skip work when its slice has not changed.

Persistence is namespaced (`aie:`), versioned, and every access is wrapped:
Safari private mode and quota errors must never break shopping. `persist.select`
projects state on the way **out** as well as on restore — applying it only on
restore is the classic bug where the drawer reopens itself on the next load.

### 4.2 Where state must not live

No module-level mutable state shared across files. The catalogue, cart, wishlist
and filter state each exist in exactly one store, and components receive them as
arguments. This is what makes replacing mock persistence with API persistence a
change to one file.

---

## 5. Cart

Frontend-only, mirroring the Phase 2 shape: **Cart → Cart Item → Product
Variant**. A line references a variant id and carries a snapshot of the product
name, slug, image, variant label, unit price and quantity.

The snapshot is deliberate: the cart must still render if a product is renamed,
archived or deleted, and opening the drawer should never await a lookup.

### 5.1 Money

Every price is an integer number of **ETB minor units**, exactly as the database
stores it. A line total is `unitPrice * quantity`, an integer multiply. Division
by 100 happens once, in `utils/format.js`, at render time. No float enters a
price anywhere in the stack.

### 5.2 Behaviour

- **Add** takes a variant id (resolved through the catalogue) or an already
  resolved variant object. Adding a variant already in the basket increases its
  quantity.
- **Ceilings.** A tracked variant is capped at `min(available, MAX_QUANTITY)`
  where `available = quantity - reserved_quantity` — offering reserved units is
  exactly how a mock becomes an oversell. Digital items have no inventory row, so
  their ceiling is the per-order maximum.
- **Quantity** never drops below 1, so a line cannot be removed by accident; use
  the remove control. It never exceeds the ceiling.
- **Remove** and **undo** are separate: `remove()` captures the line, and
  `restoreLine()` puts back the captured line rather than re-adding a
  hand-assembled variant. Rebuilding it looks equivalent and is not — a synthetic
  variant carries no availability of its own, so undo could resurrect something
  that sold out a second ago.
- **Totals ignore flagged lines.** A line that can no longer be bought must not
  inflate the subtotal or count towards free delivery; the shopper would be told
  they qualify for free shipping on the strength of an item they cannot order.
- **Reconcile** re-reads price and availability from the catalogue on load and on
  tab return. An unbuyable line is **flagged, not deleted** — silently dropping
  it would make a basket change with no explanation, and the shopper has no way
  to tell whether they imagined the item.

### 5.3 Presentation

Desktop: right-side drawer. Mobile: bottom sheet. One implementation, adapted by
breakpoint. Includes quantity steppers, remove with undo toast, subtotal,
free-delivery progress, continue shopping, view cart, and a checkout path that is
present but inert (there is no checkout yet).

---

## 6. Wishlist

Product ids only — per Phase 2 a wishlist row targets a product, not a variant,
because the shopper saves the thing and picks a size later. Holding ids also
means the list stays valid when variants change.

- `♡` unsaved, `♥` saved, with an accessible label on both states.
- Header count badge.
- Empty state explains what happened and what to do next.
- `partition()` splits a product list into saved/unsaved in one pass;
  `sortBySavedOrder()` orders by when each was saved.

No account persistence yet — it is `localStorage` and nothing more.

---

## 7. Search

Desktop opens an overlay from the header field; mobile gets a dedicated
full-screen search interface with a large input and explicit close.

- Predictive results from `mockApi.searchProducts()`, scored by match position
  and field weight (a name prefix outranks a description mention), with a rule
  that **every word must match somewhere** — otherwise "max black" returns every
  black product on the strength of "max".
- Product **and** category suggestions.
- Recent searches, in `search-history.js`.
- No-results state and a clear action.
- `?q=` deep links to the collection page.

Typo tolerance is prepared for but not implemented: the scoring function is the
single place it would go.

---

## 8. Variants

The variant UI is **derived from attribute data**, never from a product
category. A product with `color + size`, `storage + ram + color`, `size` only,
`storage` only or no attributes at all all work, because nothing asks what kind
of product it is.

- The control type per attribute is chosen from the attribute's value shape:
  colour-like values become swatches, short sets become buttons, long or numerous
  sets become a dropdown.
- `findVariantFor(product, selection)` does **partial** matching, so choosing
  "Black" before a size still prices the product instead of showing nothing.
- `canSelectAttribute()` ignores the option being tested and considers only the
  _other_ chosen attributes. This is what prevents the dead end where "Black / 42"
  is sold out and the shopper cannot work out that switching to White fixes it.
- Unavailable options are disabled **and** visibly marked as sold out, never
  hidden — a missing option reads as a rendering bug.
- Quick view cannot add an unavailable variant to the cart, and the cart
  independently refuses it.

---

## 9. Product images

Products carry 3–5 images with an `angle` label (`Front`, `Side`, `Back`,
`Detail`, `Lifestyle`, `Sample spread`, `Folded`).

- Product **card**: primary image with a hover swap to the second image on
  pointer devices, and no hover-swap on touch, where there is no hover state.
- Product **page**: thumbnail rail, main image, keyboard-operable switching,
  swipe-friendly on touch, and zoom/fullscreen foundations.
- Every image is `object-fit: cover` inside a fixed aspect ratio, so nothing is
  ever distorted and the grid keeps a steady rhythm.
- Non-critical images are lazy-loaded; the primary image is not, because it is
  the Largest Contentful Paint element.

Imagery is currently generated SVG from `mock/media.js`. Replacing it with real
photography means changing the URL, not the markup.

No 3D. The angle data is enough to make browsing front/side/back feel
considered without pretending to be a 3D viewer.

---

## 10. Navigation

**Desktop** — sticky header: announcement bar, wordmark, primary categories with
dropdown panels (two levels), inline search, wishlist, cart, account placeholder.
Keyboard accessible, with active state on the current category.

**Mobile** — compact header (menu, wordmark, search, cart), slide-in navigation
drawer with expandable category accordions, clear back and close controls.

The header is compact rather than tall: the announcement bar is dismissible and
the category strip collapses into the drawer below 64em.

**Account** — a session-aware header entry and three pages: sign in, register
and a full account page (profile, address book, security). Sign-in/register run
through `authForm`; the account page re-renders its content after every
mutation. A guest's local basket and saved items are snapshotted at sign-in and
settled by the next boot (`state/guest-merge.js`), so the transition never reads
as data loss. Detail style and layout notes live alongside the styles in
`frontend/styles/components/account.css`.

---

## 11. Product discovery flow

```
Home  ──▶  Collection (?category=…)  ──▶  Product
  │                │                        │
  │                └── search ?q=…          └── related / also-considered
  └──▶ quick view (overlay, no navigation)
```

Quick view is deliberately off the main path: it lets a shopper check a price, a
rating and availability without losing their place in a grid. "View full details"
navigates to the product page.

Every card, tile and section action links somewhere real. There are no dead
buttons and no `href="#"` placeholders — footer topics that do not exist yet are
listed as plain text with a note, rather than as links that resolve to nothing.

---

## 12. Responsive strategy

Mobile-first, with breakpoints where layout **changes** rather than merely grows.
Full details in the design system document; the storefront-specific decisions:

- **≤480px** — compact header, 2-column product grid, bottom-sheet filters,
  bottom-sheet cart, single-column checkout-style stacks.
- **480–768px** — same structure, more breathing room, larger gutters.
- **768–1024px** — 3-column grids, filter rail begins to fit beside the grid.
- **≥1024px** — full navigation, 4-column grid, filters in a sticky sidebar,
  cart as a right drawer, quick view as a centred modal.
- **≥1440px** — wider gutters, larger hero type, more columns where useful.

Touch targets are at least 44px (`--touch-target`), and hover-only affordances
are never the only way to reach something.

---

## 13. Loading, empty and error states

| Situation               | What the shopper sees                                 |
| ----------------------- | ----------------------------------------------------- |
| First paint             | Page skeleton matching the real layout                |
| Catalogue loading       | Section skeletons; grid keeps its geometry            |
| Catalogue failed        | Error state naming the problem, with Retry            |
| Product unavailable     | In-page message with a route back to the shop         |
| Search failed           | Error state inside the overlay, search text preserved |
| Search empty            | No-results state with a clear action                  |
| Cart empty              | Explanation plus continue shopping                    |
| Basket partly unbuyable | Flagged lines with an explanation and a remove action |
| Wishlist empty          | Explanation plus a route to the shop                  |
| Filtered to nothing     | "No matches" plus a clear-filters action              |

Every one answers two questions: what happened, and what to do next. None expose
a stack trace or an error code.

Skeletons mirror the geometry of the component they stand in for, so nothing
reflows when content arrives.

The mock service can be made to fail on purpose for review:
`?fail=catalogue`, `?fail=product`, `?fail=search`, `?fail=offline`, or
`aie.setMockFailure('catalogue')`.

---

## 14. Accessibility

- Semantic landmarks; one `h1` per page; no skipped heading levels.
- Every section labelled via `aria-labelledby`.
- Overlay primitive handles Escape, click-outside, focus trap, focus restore,
  scroll locking and focus-on-open — shared by modal, drawer, sheet, dropdown and
  popover.
- Live regions for cart count, wishlist toggle, filter result count, form errors
  and toasts.
- Icon-only controls have `aria-label`; decorative icons are `aria-hidden`.
- Disabled and unavailable states are never signalled by colour alone.
- `prefers-reduced-motion` collapses every duration token to 1ms.
- Skip link is the first focusable element on every page.
- Keyboard shortcuts (`/` search, `c` cart, Escape close) are suppressed while
  typing.

---

## 15. Performance

- No build step, no framework, no runtime dependency on the storefront. Express
  is a dev-server convenience only.
- Page modules are dynamically imported, so a page downloads only its own code.
- Stores notify in one batched microtask; selectors let a component skip work
  when its slice is unchanged.
- Reveal-on-scroll uses `IntersectionObserver`, not a scroll listener, and is
  one-shot.
- Event listeners are delegated at list containers and cleaned up on `destroy()`,
  with all teardown registered and run on `pagehide`.
- Images carry intrinsic dimensions and aspect ratios to avoid layout shift, and
  non-primary images are lazy-loaded.
- Search and filters are pure functions over an in-memory catalogue; a filter
  change costs no network round trip.

---

## 16. Tests

`npm run test:frontend` — 153 assertions across 8 files, using `node:test` like
the backend, with no test framework dependency.

| File                | Covers                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `store.test.js`     | Immutability, microtask batching, subscriber isolation, selector semantics, versioned persistence                        |
| `cart.test.js`      | Add/remove/step/undo, stock ceilings, reserved units, integer totals, unavailable-line exclusion, free-delivery progress |
| `wishlist.test.js`  | Toggle, ordering, id normalisation, partition, per-product selectors                                                     |
| `catalogue.test.js` | Lookups, listability, descendant categories, breadcrumbs, merchandising selectors, facet counts                          |
| `filters.test.js`   | Every facet, sort stability, pagination without loss or duplication, chips                                               |
| `mock-api.test.js`  | Service seam, `{ data }` shape, `ApiError`, abort, search scoring, and the dataset requirements                          |
| `format.test.js`    | Minor-unit money, discount maths, plurals, dates, truncation                                                             |

Only pure modules are tested — the DOM-bound components (`core/dom.js`,
`utils/icons.js`, `focus-trap.js`, `scroll-lock.js`) need a browser environment
and are covered by manual QA. Deliberately: a DOM shim would test the shim.

`npm run verify` runs lint, format check and both workspaces' tests.

---

## 17. Integration points

What changes when the backend lands:

| Now                              | Later                                                                                      |
| -------------------------------- | ------------------------------------------------------------------------------------------ |
| `mockApi` imported in `app.js`   | `api` from `core/api.js` — same method names and `{ data }` shape                          |
| `boot()` awaits `getCatalogue()` | Unchanged; add caching if the category list warrants it                                    |
| Cart in `localStorage`           | Cart endpoints; `cart.add/remove/setQuantity` become requests, state shape unchanged       |
| Wishlist in `localStorage`       | Wishlist endpoints behind authentication (guest basket already snapshots for the upload)   |
| `searchProducts()` client-side   | `GET /products/search`; the UI already treats it as async and handles failure              |
| Filters applied in memory        | Optional server-side filtering and pagination; `queryProducts` keeps the same result shape |
| Auth pages, account page         | Done — profiles/addresses/password already hit the real API; catalogues still mock         |
| Checkout button inert            | Checkout flow, orders, payments                                                            |

The rule throughout: **components receive data and configuration, never fetch
it.** Swapping the client changes `app.js`, not a single component.

---

## 18. Deliberately not built

- Cart, wishlist and catalogue still run on the mock service — real endpoints
  land with their phases
- Password reset and email verification
- Checkout, payment, order creation, order history
- Admin dashboard
- Analytics or any invented sales figure
- Reviews submission (reviews are read-only fixtures)
- 3D product viewer

Each is deferred to a later phase, not overlooked. Nothing in the storefront
depends on them, and no component assumes they exist.
