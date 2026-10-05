# Pages

One HTML entry point per route at the **frontend root**, and one module per page
in `js/pages/`. This directory holds no HTML; it exists as an index of the
route → file → module mapping.

| Route              | HTML              | Module                   | Status   |
| ------------------ | ----------------- | ------------------------ | -------- |
| `/`                | `index.html`      | `js/pages/home.js`       | complete |
| `/collection.html` | `collection.html` | `js/pages/collection.js` | complete |
| `/product.html`    | `product.html`    | `js/pages/product.js`    | complete |
| `/cart.html`       | `cart.html`       | `js/pages/cart.js`       | complete |
| `/wishlist.html`   | `wishlist.html`   | `js/pages/wishlist.js`   | complete |

Planned for later phases, and deliberately absent for now:

| Route            | Planned module         | Phase |
| ---------------- | ---------------------- | ----- |
| `/checkout.html` | `js/pages/checkout.js` | 8     |
| `/account.html`  | `js/pages/account.js`  | 5     |
| `/admin.html`    | `js/pages/admin.js`    | 11    |

## Anatomy of a page

Each page is thin. It provides a document shell, an empty `#main-content`, and
one script tag:

```html
<link rel="stylesheet" href="/styles/main.css" />
<script type="module" src="/js/app.js" data-page="collection"></script>
```

`app.js` builds the shared shell and dynamically imports the module named by
`data-page`. That means:

- `data-page` must match a key in the `js/pages/` map in `app.js`.
- The page module receives `{ config, api, dom, state, components }` and owns
  exactly one thing: filling `#main-content`.
- A page must not re-declare the header, footer, cart drawer or search overlay.
  They belong to the shell.
- Exactly one `<h1>` per page, with no skipped heading levels.
- Reuse components from `js/components/` rather than duplicating markup; if a
  page needs its own layout, it composes components inside a local section
  function.

## Collection URL state

`collection.html` round-trips its view through the query string, so any view is
linkable:

```
/collection.html?q=linen&category=apparel&sort=price-asc&sale=1&stock=1
```

- The URL is read as a complete description of the query, not a patch, so
  "All products" genuinely clears the search term instead of restoring it from
  persisted state.
- Unknown or malformed values fall back to defaults: an unrecognised `sort` is
  ignored, an unresolvable `category` slug is ignored.
- Writes use `replaceState`, not `pushState`, so typing in a price field does not
  fill the history stack. The back button leaves the page rather than stepping
  through every filter change.
- Attribute and price ranges are session-only for now, and page number always
  restarts on load.

## Product page

`product.html` accepts `?slug=` (used by every internal link, since it is
readable) or `?id=`, and writes the chosen `?variant=` back to the URL so a
selection is shareable and survives a reload. A missing or unresolvable slug
renders a real "not found" state with a route back to the shop — never a blank
page. There is no product detail route yet; a router would arrive with the real
API phase.
