/**
 * Order history page.
 *
 * The customer's own orders, newest first, each expandable to its full
 * snapshot. History is per-customer by construction: the endpoint sits behind
 * `authenticate` and the server scopes every query by the session user, so this
 * page has no authorization decision to make — a signed-out visitor is offered
 * a sign-in, and an order that belongs to someone else is simply absent.
 *
 * The list response already carries each order's lines (`toOrderSummary`), so
 * the card renders without a second request. The full record — delivery address
 * and payment — is fetched lazily the first time an order is expanded.
 *
 * Pagination lives in the response `meta`, which is why this page uses the
 * client's `getPage` rather than `get`.
 */
import { el, clear } from '../core/dom.js';
import { api } from '../core/api.js';
import { button } from '../components/ui/button.js';
import { pageTitle } from '../components/layout/page-header.js';
import { breadcrumb } from '../components/layout/breadcrumb.js';
import { errorState, state } from '../components/feedback/states.js';
import { formatCount, formatDate, formatMoney } from '../utils/format.js';
import {
  orderStatusBadge,
  orderItemsList,
  orderTotals,
  orderAddressBlock,
  orderPaymentBlock,
} from '../components/order/order-view.js';

const PAGE_SIZE = 20;

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.auth
 * @param {object} [options.client] API client, injectable for tests
 * @returns {{ destroy(): void }}
 */
export default async function ordersPage({ host, auth, client = api }) {
  document.title = 'Your orders - Aster & Oak';
  if (auth.selectStatus() === 'unknown') await auth.refresh();

  const shell = el('div.container.account-shell');
  host.replaceChildren(shell);
  shell.append(breadcrumb([{ label: 'Account', href: '/account.html' }, { label: 'Orders' }]));

  if (auth.selectStatus() === 'failure') {
    shell.append(
      errorState({
        error: { code: 'NETWORK_ERROR' },
        title: 'We could not reach the store',
        onRetry: () => globalThis.location.reload(),
      })
    );
    return { destroy: () => {} };
  }

  if (!auth.selectUser()) {
    shell.append(signInPrompt());
    return { destroy: () => {} };
  }

  shell.append(pageTitle('Your orders', { eyebrow: 'Order history' }));

  const list = el('div.orders');
  shell.append(list);

  // `getPage` returns `{ data, meta }`; an injected test client may only have
  // `get`, in which case pagination degrades to a single page rather than
  // crashing.
  const fetchPage = client.getPage
    ? client.getPage.bind(client)
    : async (path, options) => ({ data: await client.get(path, options), meta: null });

  let page = 1;
  let orders = [];
  let pagination = null;
  let error = null;
  let loaded = false;
  let loading = false;

  /** Order numbers whose full record has been fetched. */
  const details = new Map();
  /** Order numbers currently expanded. */
  const expanded = new Set();

  async function load({ more = false } = {}) {
    if (loading) return;
    loading = true;
    error = null;
    if (!more) {
      orders = [];
      loaded = false;
    }
    draw();

    try {
      const { data, meta } = await fetchPage('/orders', { query: { page, limit: PAGE_SIZE } });
      const batch = data?.orders ?? [];
      orders = more ? [...orders, ...batch] : batch;
      pagination = meta?.pagination ?? null;
    } catch (requestError) {
      error = requestError;
    } finally {
      loading = false;
      loaded = true;
      draw();
    }
  }

  async function loadDetails(orderNumber) {
    if (details.has(orderNumber)) return;
    try {
      const data = await client.get(`/orders/${encodeURIComponent(orderNumber)}`);
      if (data?.order) details.set(orderNumber, data.order);
    } catch (requestError) {
      details.set(orderNumber, { error: requestError });
    }
    draw();
  }

  function toggle(orderNumber) {
    if (expanded.has(orderNumber)) {
      expanded.delete(orderNumber);
      draw();
      return;
    }
    expanded.add(orderNumber);
    if (!details.has(orderNumber)) {
      void loadDetails(orderNumber);
      return;
    }
    draw();
  }

  function draw() {
    clear(list);

    if (loading && !loaded) {
      list.append(el('p.orders__loading', { role: 'status', text: 'Loading your orders…' }));
      return;
    }

    if (error) {
      list.append(
        errorState({
          error,
          title: 'Your orders could not be loaded',
          onRetry: () => load(),
        })
      );
      return;
    }

    if (orders.length === 0) {
      list.append(
        state({
          variant: 'empty',
          icon: 'package',
          title: 'No orders yet',
          description: 'When you place an order, it will appear here with its full history.',
          actions: [{ label: 'Start shopping', href: '/collection.html', variant: 'primary' }],
        })
      );
      return;
    }

    list.append(
      ...orders.map((order) => orderCard(order)),
      pagination?.hasNextPage
        ? el('div.orders__more', {}, [
            button({
              label: loading ? 'Loading…' : 'Load older orders',
              variant: 'secondary',
              onClick: () => {
                page += 1;
                void load({ more: true });
              },
            }).element,
          ])
        : null
    );
  }

  function orderCard(order) {
    const isOpen = expanded.has(order.orderNumber);
    const detail = details.get(order.orderNumber);
    const panelId = `order-detail-${order.orderNumber}`;

    const detailNode = el('div.order-card__detail', { id: panelId, hidden: !isOpen });

    if (isOpen) {
      if (detail?.error) {
        detailNode.append(
          el('p.form-alert.form-alert--error', {
            role: 'alert',
            text: 'The full order could not be loaded. Please try again.',
          })
        );
      } else if (detail) {
        detailNode.append(orderAddressBlock(detail.shippingAddress), orderPaymentBlock(detail));
      } else {
        detailNode.append(el('p.orders__loading', { role: 'status', text: 'Loading details…' }));
      }
    }

    return el('article.order-card', {}, [
      el('header.order-card__head', {}, [
        el('div', {}, [
          el('p.order-card__number', { text: order.orderNumber }),
          el('p.order-card__date', {
            text: `${formatDate(order.placedAt)} · ${formatCount(order.itemCount, 'item')}`,
          }),
        ]),
        el('div.order-card__head-side', {}, [
          orderStatusBadge(order.status),
          el('p.order-card__total', { text: formatMoney(order.total) }),
        ]),
      ]),

      orderItemsList(order.items),
      orderTotals(order),

      el('div.order-card__actions', {}, [
        button({
          label: isOpen ? 'Hide details' : 'View details',
          variant: 'ghost',
          size: 'sm',
          icon: isOpen ? 'chevron-down' : 'chevron-right',
          expanded: isOpen,
          controls: panelId,
          onClick: () => toggle(order.orderNumber),
        }).element,
      ]),

      detailNode,
    ]);
  }

  await load();

  return { destroy: () => {} };
}

/** The signed-out outcome, mirroring the account page. */
function signInPrompt() {
  return state({
    variant: 'info',
    icon: 'user',
    title: 'Sign in to see your orders',
    description: 'Your order history lives behind your account.',
    actions: [
      { label: 'Sign in', href: '/login.html?redirect=/orders.html', variant: 'primary' },
      { label: 'Create an account', href: '/register.html', variant: 'ghost' },
    ],
  });
}
