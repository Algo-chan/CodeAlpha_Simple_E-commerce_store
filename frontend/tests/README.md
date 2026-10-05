# Frontend tests

`node:test`, like the backend. No test framework dependency.

```bash
npm run test:frontend      # from the repository root
npm test                   # from frontend/
npm run test:watch         # from frontend/
```

Run from the repository root, `npm test` runs the backend tests first and the
frontend tests second, so a single command verifies both workspaces.

## What is covered

| File                | Covers                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store.test.js`     | Immutable updates, microtask batching, stable notification handle, subscriber isolation when one throws, selector semantics, versioned persistence, persistence failures |
| `cart.test.js`      | Add/remove/step/undo, quantity ceilings, reserved-unit maths, integer minor-unit totals, unavailable-line exclusion from totals, free-delivery progress, reconcile       |
| `wishlist.test.js`  | Toggle, saved order, id normalisation, partition, per-product selectors                                                                                                  |
| `catalogue.test.js` | Lookups by id/slug, listability, descendant categories, breadcrumbs, featured/new/popular selectors, facet counts, unpublished products excluded                         |
| `filters.test.js`   | Every facet, multi-select within and across facets, sort stability, pagination without loss or duplication, active-filter chips                                          |
| `mock-api.test.js`  | Service seam, `{ data }` shape, `ApiError` on failure, abort handling, search scoring rules, and the dataset requirements from Phase 4                                   |
| `format.test.js`    | Minor-unit money, discount maths, pluralisation, dates, truncation                                                                                                       |

These cover the parts where a bug is silent and expensive: money arithmetic,
stock ceilings, and publication rules. A mock that oversells or shows an archived
product is worse than one that crashes.

## What is not covered

`core/dom.js`, `utils/icons.js`, `utils/focus-trap.js` and `utils/scroll-lock.js`
need a browser environment, and so do the DOM-bound components. They are covered
by manual QA instead.

Deliberately: a hand-rolled DOM shim would mostly test the shim, and a browser
automation dependency was not introduced for this phase. When the backend lands
and the mock is replaced, the pure logic tests keep their value because the shape
of the view models is unchanged — and the same suites then cover the real
catalogue builder.

## Adding tests

- Test pure logic, not markup. A test that asserts on a CSS class is testing
  the design, and the design is meant to change.
- Name the behaviour, not the function: "a line that cannot be bought is
  excluded from the subtotal" beats "test 4".
- Cover the boundaries: quantity 0 and 1, ceiling exactly reached, one over,
  zero inventory, one-cent prices, empty lists, single-item lists.
- If a test needs a browser, it belongs in manual QA until a DOM environment
  exists.
