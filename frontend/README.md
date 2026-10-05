# Frontend

Vanilla HTML5 + CSS3 + ES6 modules. No framework, no bundler, no build step.

The storefront currently makes **no** API calls. Everything renders from fixtures
in `js/mock/`, and cart plus wishlist persist to `localStorage`. See
[`../docs/frontend-storefront.md`](../docs/frontend-storefront.md) for the
architecture and [`../docs/frontend-design-system.md`](../docs/frontend-design-system.md)
for the tokens and primitives.

## Running

```bash
npm run dev:frontend        # http://localhost:5173
```

or from this directory, `npm run dev`. The backend is optional — the storefront
works with it stopped.

| Route              | Page module              |
| ------------------ | ------------------------ |
| `/`                | `js/pages/home.js`       |
| `/collection.html` | `js/pages/collection.js` |
| `/product.html`    | `js/pages/product.js`    |
| `/cart.html`       | `js/pages/cart.js`       |
| `/wishlist.html`   | `js/pages/wishlist.js`   |

## Folder map

```
frontend/
├── index.html            home
├── collection.html       collection   product.html   product
├── cart.html             cart         wishlist.html  wishlist
├── server.js             static dev server (npm run dev)
├── styles/               the only stylesheet source: pages load styles/main.css
│   ├── tokens.css        colour, type, space, layout, borders, shadow, motion, z-index
│   ├── reset.css         modern reset
│   ├── base.css          element defaults + accessibility
│   ├── layout.css        container, grid, section rhythm
│   ├── utilities.css     small single-purpose helpers
│   ├── animations.css    keyframes, reveal, reduced-motion
│   └── components/       one file per component
├── js/
│   ├── app.js            the only entry point: shell, routing, boot
│   ├── config.js         API base URL + configurable brand/running settings
│   ├── core/
│   │   ├── api.js        fetch wrapper, envelope unwrapping, ApiError
│   │   └── dom.js        el(), append(), qs() and DOM helpers
│   ├── mock/             fixtures shaped like the Phase 2 schema
│   │   ├── api.js        createMockClient(): same methods as core/api.js
│   │   ├── products.js   product / variant / inventory / review rows
│   │   ├── categories.js category rows + buildTree()
│   │   ├── media.js      generated SVG imagery per product
│   │   └── view.js       buildCatalogue(): rows -> view models
│   ├── state/            observable stores, no state library
│   │   ├── store.js      the primitive: immutable, batched, persisted
│   │   ├── catalogue.js  products, categories, facets, merchandising
│   │   ├── cart.js       lines, totals, stock ceilings, reconcile
│   │   ├── wishlist.js   saved product ids
│   │   ├── filters.js    facet state + pure filter/sort/query
│   │   ├── search-history.js
│   │   └── ui.js         drawer/modal visibility, toasts
│   ├── components/       one component per file, context-agnostic
│   │   ├── README.md     component contract and conventions
│   │   ├── layout/       announcement, header, footer, breadcrumb, page-header
│   │   ├── navigation/   nav, mobile-nav
│   │   ├── search/       search-overlay
│   │   ├── product/      product-card, product-gallery, variant-picker,
│   │   │                 quick-view, price, wishlist-button
│   │   ├── collection/   collection-page
│   │   ├── cart/         cart-drawer, cart-line
│   │   ├── forms/        field, choice, stepper
│   │   ├── feedback/     overlay, skeleton, states, toast
│   │   └── ui/           button, badge, rating
│   ├── pages/            one module per route, dynamically imported
│   └── utils/            format, focus-trap, icons, scroll-lock
├── tests/                node:test suites for the pure logic
├── pages/README.md       route -> file mapping (legacy index)
└── assets/               static assets
```

## How a page boots

Every HTML page ends with one tag:

```html
<script type="module" src="/js/app.js" data-page="collection"></script>
```

`app.js` reads `data-page`, mounts the toast region, awaits the catalogue,
renders the shared shell (header, footer, mobile nav, cart drawer, search
overlay), then dynamically imports that page's module and hands it `#main-content`.

So a shopper on the collection page never downloads the product page, and the
shell exists exactly once instead of being duplicated across five HTML files.

## Talking to the backend

Not wired up yet, but the seam is in place.

1. `js/config.js` holds `apiBaseUrl` (default `http://localhost:4000/api/v1`).
2. `js/core/api.js` builds the URL, adds `Accept: application/json`, enforces a
   timeout, unwraps the `{ success, data }` envelope and throws a normalized
   `ApiError` otherwise.
3. The backend's CORS config (driven by `FRONTEND_URL`) allows this origin.
4. Pages never call `fetch` directly — only through `js/core/api.js`, and today
   the object handed to components is `mockApi` from `js/mock/api.js`.

Both clients expose `getCatalogue`, `getProduct`, `searchProducts` and
`getFacets` and return the same normalised view models, so switching is a change
to the import in `app.js` — no component changes.

```js
// current
import { mockApi as api } from './mock/api.js';

// when the backend lands
import { api } from './core/api.js';
```

## Testing

```bash
npm run test:frontend      # from the repository root
npm test                   # inside frontend/
```

153 assertions over the pure logic (stores, cart maths, filters, catalogue
selectors, formatting, the mock service). DOM-bound modules need a browser and
are covered by manual QA — see `tests/README.md`.
