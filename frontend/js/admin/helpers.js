/**
 * Admin console — pure helpers.
 *
 * Everything in this file is a plain function of its arguments: no DOM, no
 * network. That keeps the store-management rules that the UI needs to reason
 * about — the order lifecycle, how a status maps to a colour, how a hash turns
 * into a route — in one place that a Node test can exercise directly, without a
 * browser.
 *
 * NOTHING HERE IS A SECURITY BOUNDARY. The order graph and the enum lists are
 * mirrored from the backend constants so the console can offer the right
 * controls and explain a refusal; the server still rejects anything this file
 * would have allowed. The client-side copy exists to make the UI honest, not to
 * enforce anything.
 */

/** The order lifecycle, identical to `ORDER_TRANSITIONS` in the backend. */
export const ORDER_TRANSITIONS = Object.freeze({
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
});

export const ORDER_STATUSES = Object.freeze(Object.keys(ORDER_TRANSITIONS));
export const PAYMENT_STATUSES = Object.freeze(['PENDING', 'PAID', 'FAILED', 'REFUNDED']);
export const PAYMENT_METHODS = Object.freeze(['COD', 'ONLINE']);
export const PRODUCT_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'ARCHIVED']);
export const PRODUCT_TYPES = Object.freeze(['PHYSICAL', 'DIGITAL']);
export const CUSTOMER_STATUSES = Object.freeze(['ACTIVE', 'SUSPENDED', 'INACTIVE']);
export const REVIEW_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED']);
export const ADJUSTMENT_TYPES = Object.freeze(['RESTOCK', 'RETURN', 'DAMAGE', 'ADJUSTMENT']);
export const COUPON_TYPES = Object.freeze(['PERCENT', 'FIXED']);

export const ADMIN_SECTIONS = Object.freeze([
  { id: 'dashboard', label: 'Dashboard', icon: 'home' },
  { id: 'products', label: 'Products', icon: 'package' },
  { id: 'categories', label: 'Categories', icon: 'layers' },
  { id: 'inventory', label: 'Inventory', icon: 'ruler' },
  { id: 'orders', label: 'Orders', icon: 'truck' },
  { id: 'customers', label: 'Customers', icon: 'user' },
  { id: 'reviews', label: 'Reviews', icon: 'star' },
  { id: 'payments', label: 'Payments', icon: 'banknote' },
  { id: 'coupons', label: 'Coupons', icon: 'percent' },
  { id: 'audit', label: 'Audit log', icon: 'shield' },
]);

const SECTION_IDS = new Set(ADMIN_SECTIONS.map((section) => section.id));

/**
 * The statuses an order may move to from `status`. Always a fresh array, so a
 * caller cannot mutate the frozen graph through the return value.
 * @param {string} status
 * @returns {string[]}
 */
export function orderTransitions(status) {
  return [...(ORDER_TRANSITIONS[status] ?? [])];
}

/**
 * Whether the lifecycle allows `from -> to`. Used to decide which status
 * buttons to render and to disable the rest, not to authorise anything.
 * @param {string} from
 * @param {string} to
 */
export function canTransition(from, to) {
  return orderTransitions(from).includes(to);
}

/** `RESTOCK` -> "Restock". Falls back to the raw value for anything unknown. */
export function humanize(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Line label: "PENDING" -> "Pending"; acronyms are handled by `humanize`. */
export function statusLabel(status) {
  return humanize(status);
}

const TONES = {
  ORDER: {
    PENDING: 'warning',
    CONFIRMED: 'info',
    PROCESSING: 'info',
    SHIPPED: 'info',
    DELIVERED: 'success',
    CANCELLED: 'danger',
  },
  PAYMENT: {
    PENDING: 'warning',
    PAID: 'success',
    FAILED: 'danger',
    REFUNDED: 'neutral',
  },
  PRODUCT: { DRAFT: 'warning', ACTIVE: 'success', ARCHIVED: 'neutral' },
  CUSTOMER: { ACTIVE: 'success', SUSPENDED: 'danger', INACTIVE: 'neutral' },
  REVIEW: { PENDING: 'warning', APPROVED: 'success', REJECTED: 'danger' },
  COUPON: { true: 'success', false: 'neutral' },
  INVENTORY: {
    RESTOCK: 'success',
    RETURN: 'success',
    DAMAGE: 'danger',
    ADJUSTMENT: 'info',
    SALE: 'neutral',
  },
};

/**
 * Maps a status to a badge tone for a given domain. An unknown pair is
 * `neutral` rather than a crash — a new enum value on the server must not blank
 * the table.
 * @param {'ORDER'|'PAYMENT'|'PRODUCT'|'CUSTOMER'|'REVIEW'|'COUPON'|'INVENTORY'} domain
 * @param {string} value
 * @returns {'neutral'|'info'|'success'|'warning'|'danger'}
 */
export function toneFor(domain, value) {
  return TONES[domain]?.[value] ?? 'neutral';
}

/**
 * Whether an inventory balance is at or below its reorder level.
 * Mirrors the server's definition: `(quantity - reserved) <= reorderLevel`.
 * @param {{ quantity:number, reservedQuantity:number, reorderLevel:number }} item
 */
export function isLowStock(item) {
  const available = Number(item.quantity ?? 0) - Number(item.reservedQuantity ?? 0);
  return available <= Number(item.reorderLevel ?? 0);
}

/** `+4` / `-3` / `4` for a ledger movement, so a signed row reads correctly. */
export function signedQuantity(quantity) {
  const value = Number(quantity) || 0;
  return value > 0 ? `+${value}` : String(value);
}

/** RESTOCK/RETURN add (sign 1), DAMAGE removes (sign -1), ADJUSTMENT is signed. */
export function adjustmentSign(type) {
  if (type === 'RESTOCK' || type === 'RETURN') return 1;
  if (type === 'DAMAGE') return -1;
  return 0;
}

/** Explains a movement type in the adjust dialog, e.g. "Adds 4 units to stock." */
export function describeAdjustment(type, quantity) {
  const size = Math.abs(Number(quantity) || 0);
  switch (type) {
    case 'RESTOCK':
      return `Adds ${size} to the available stock.`;
    case 'RETURN':
      return `Returns ${size} to stock.`;
    case 'DAMAGE':
      return `Removes ${size} from the available stock.`;
    case 'ADJUSTMENT':
      return 'Sets the stock by the signed amount you enter (a correction).';
    default:
      return '';
  }
}

/** Renders a variant's attribute object as a readable single line. */
export function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '—';
  const entries = Object.entries(attributes).filter(([, value]) => value !== '');
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

/**
 * Turns a location hash into `{ section, id }`.
 *
 * `#/products/2f6c...` -> `{ section: 'products', id: '2f6c...' }`
 * `#/` or `#` or an unknown section -> the dashboard.
 * @param {string} hash
 */
export function parseRoute(hash) {
  const raw = String(hash ?? '')
    .replace(/^#\/?/, '')
    .replace(/\/+$/, '');
  if (!raw) return { section: 'dashboard', id: null };

  const [section, ...rest] = raw.split('/');
  const id = rest.length > 0 ? decodeURIComponent(rest.join('/')) : null;
  if (!SECTION_IDS.has(section)) return { section: 'dashboard', id: null };
  return { section, id };
}

/** The inverse of `parseRoute`. */
export function buildRoute(section, id = null) {
  const safeSection = SECTION_IDS.has(section) ? section : 'dashboard';
  return id ? `#/${safeSection}/${encodeURIComponent(id)}` : `#/${safeSection}`;
}

/** A product's price range as "ETB 10 – ETB 25", or a single price. */
export function priceRangeLabel(product, formatMoney) {
  const { priceMin, priceMax } = product;
  if (priceMin === null || priceMin === undefined) return '—';
  if (priceMax === null || priceMax === undefined || priceMax === priceMin) {
    return formatMoney(priceMin);
  }
  return `${formatMoney(priceMin)} – ${formatMoney(priceMax)}`;
}

/** A stable, human title for a route, used in the top bar. */
export function sectionTitle(section) {
  return ADMIN_SECTIONS.find((entry) => entry.id === section)?.label ?? 'Dashboard';
}

export default {
  ORDER_TRANSITIONS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  CUSTOMER_STATUSES,
  REVIEW_STATUSES,
  ADJUSTMENT_TYPES,
  COUPON_TYPES,
  ADMIN_SECTIONS,
  orderTransitions,
  canTransition,
  humanize,
  statusLabel,
  toneFor,
  isLowStock,
  signedQuantity,
  adjustmentSign,
  describeAdjustment,
  formatAttributes,
  parseRoute,
  buildRoute,
  priceRangeLabel,
  sectionTitle,
};
