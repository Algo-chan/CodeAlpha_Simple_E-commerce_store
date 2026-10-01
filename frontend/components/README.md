# Components

Each component is **one file per component** in `js/components/`, exporting a
factory that returns a DOM node:

```js
// js/components/product-card.js
import { el } from '../core/dom.js';

export function ProductCard({ product }) {
  return el('article.card', {}, [el('h3.card__title', { text: product.name })]);
}

export default ProductCard;
```

## Rules

1. **No framework.** Components build DOM with `js/core/dom.js` helpers.
2. **No global state.** Each component receives props and returns a node.
   Shared state belongs in `js/store/`.
3. **No direct `fetch`.** Network calls go through `js/core/api.js`.
4. **Styling via tokens.** Use CSS variables from `css/tokens.css`; component
   styles live in `css/components/<name>.css` and are imported by `main.css`.
5. **Accessibility first.** Semantic elements, labels, `aria-*` where needed,
   visible keyboard focus.
6. **Accessible name.** Render a visually hidden `<h1>`/`<h2>` per view.

## Planned components

| Component       | File                  | Status                            |
| --------------- | --------------------- | --------------------------------- |
| Navbar          | `navbar.js`           | placeholder markup in `partials/` |
| Footer          | `footer.js`           | placeholder markup in `partials/` |
| Button          | `button.js`           | planned                           |
| Form fields     | `form-field.js`       | planned                           |
| ProductCard     | `product-card.js`     | planned                           |
| ProductGallery  | `product-gallery.js`  | planned                           |
| Search          | `search.js`           | planned                           |
| FilterPanel     | `filter-panel.js`     | planned                           |
| CartDrawer      | `cart-drawer.js`      | planned                           |
| Modal           | `modal.js`            | planned                           |
| Toast           | `toast.js`            | planned                           |
| LoadingSkeleton | `loading-skeleton.js` | planned                           |
| Pagination      | `pagination.js`       | planned                           |

`js/core/registry.js` documents the registry pattern used for cross-page reuse.
