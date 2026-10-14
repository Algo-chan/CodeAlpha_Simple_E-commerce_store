/**
 * Cache policy.
 *
 * The API is default-deny: every response is `no-store` unless a route
 * deliberately overrides it. That matters because the alternative — no header
 * at all — lets a shared cache or a browser make a heuristic decision about a
 * response that contains one customer's cart, orders or session state.
 *
 * The public catalogue, category and search routes are the exceptions. They set
 * `Cache-Control: public, ...` themselves (see `catalogue.routes.js`), and a
 * later `res.set` replaces this value, so the "default private, opt into public"
 * direction is enforced in one place rather than trusted to every new route.
 */

/** Sets `Cache-Control: no-store`, the default for anything not marked public. */
export function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

export default { noStore };
