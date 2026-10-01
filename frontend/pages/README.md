# Pages

One HTML file per route. Real pages are added here as features are built:

| Route          | File            | Status                   |
| -------------- | --------------- | ------------------------ |
| `/`            | `../index.html` | setup-phase landing page |
| `/products`    | `products.html` | planned                  |
| `/product/:id` | `product.html`  | planned                  |
| `/cart`        | `cart.html`     | planned                  |
| `/checkout`    | `checkout.html` | planned                  |
| `/account`     | `account.html`  | planned                  |
| `/admin`       | `admin.html`    | planned                  |

Each page:

1. Loads `/css/main.css` and `/js/main.js` with `data-page="<name>"`.
2. Has exactly one `<h1>` and a matching module in `js/pages/<name>.js`.
3. Reuses components from `js/components/` instead of duplicating markup.

The dev server resolves `/products` to `pages/products.html` automatically.
