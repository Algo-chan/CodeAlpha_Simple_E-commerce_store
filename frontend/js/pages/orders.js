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
import {
  REVIEW_RATING_VALUES,
  buildReviewBody,
  isReviewSubmittable,
  groupReviewableByOrder,
  describeReviewError,
} from '../utils/review.js';

const PAGE_SIZE = 20;

/**
 * @param {object} options
 * @param {HTMLElement} options.host
 * @param {object} options.auth
 * @param {object} [options.client] API client, injectable for tests
 * @returns {{ destroy(): void }}
 */
export default async function ordersPage({ host, auth, client = api }) {
  document.title = 'Your orders - Roman Store';
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

  /**
   * Purchases this shopper may still review, grouped by the order they came
   * from. Populated from `/reviews/reviewable`, which the server scopes to the
   * session; if that call fails the orders list still renders without the
   * "write a review" action rather than dragging the whole page down.
   */
  let reviewableByOrder = new Map();
  /** Draft form state per order item, keyed by orderItemId, preserved across redraws. */
  const reviewDrafts = new Map();
  /** Items accepted this session, grouped by order number, so a thanks note lingers. */
  const submittedByOrder = new Map();

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

  /**
   * Fetches what this shopper may still review and groups it by order.
   *
   * Failures are swallowed on purpose: reviews are a bonus on top of the order
   * history, and a shopper whose browser blocks the request should still see
   * their purchases.
   */
  async function loadReviewable() {
    try {
      const data = await client.get('/reviews/reviewable');
      reviewableByOrder = groupReviewableByOrder(data?.items ?? []);
    } catch {
      reviewableByOrder = new Map();
    }
  }

  /** Removes a reviewed item from the offer and refiles it under its order. */
  function markSubmitted(item, productName) {
    const orderKey = item.orderNumber ?? '';
    const list = submittedByOrder.get(orderKey) ?? [];
    list.push(productName);
    submittedByOrder.set(orderKey, list);

    const remaining = [];
    for (const [orderKey_, items] of reviewableByOrder) {
      const kept = items.filter((candidate) => candidate.orderItemId !== item.orderItemId);
      if (kept.length > 0) remaining.push([orderKey_, kept]);
    }
    reviewableByOrder = new Map(remaining);
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

  /**
   * The "write a review" controls for one purchased line.
   *
   * The draft lives in `reviewDrafts`, not in the DOM, so toggling an unrelated
   * order's details or loading another page does not silently discard what the
   * shopper typed. The submit button is disabled until the draft would pass the
   * server's own rules (`isReviewSubmittable`), so an ineligible submission is
   * caught here instead of round-tripping to a 422.
   */
  function reviewForm(item) {
    const draft = reviewDrafts.get(item.orderItemId) ?? {
      rating: 0,
      title: '',
      comment: '',
      error: null,
    };
    reviewDrafts.set(item.orderItemId, draft);

    const errorNode = el('p.form-alert.form-alert--error', {
      role: 'alert',
      hidden: !draft.error,
      text: draft.error ?? '',
    });

    const starChoices = REVIEW_RATING_VALUES.map((value) =>
      el('label.review-stars__choice', {}, [
        el('input.review-stars__input', {
          type: 'radio',
          name: `review-rating-${item.orderItemId}`,
          value,
          checked: draft.rating === value,
          onChange: () => {
            draft.rating = value;
            if (draft.error) {
              draft.error = null;
              errorNode.hidden = true;
            }
            refreshSubmit();
          },
        }),
        el('span.review-stars__label', { text: String(value) }),
      ])
    );

    const titleInput = el('input.review-form__input', {
      type: 'text',
      maxlength: 120,
      placeholder: 'Headline (optional)',
      value: draft.title,
      onInput: (event) => {
        draft.title = event.target.value;
        refreshSubmit();
      },
    });

    const commentInput = el(
      'textarea.review-form__textarea',
      {
        rows: 3,
        maxlength: 2000,
        placeholder: 'What did you think? (optional)',
        onInput: (event) => {
          draft.comment = event.target.value;
          refreshSubmit();
        },
      },
      [draft.comment]
    );

    const submit = button({ label: 'Submit review', variant: 'primary', size: 'sm' });

    function refreshSubmit() {
      submit.element.disabled = !isReviewSubmittable(draft).ok;
    }
    refreshSubmit();

    submit.element.addEventListener('click', () =>
      submit.run(async () => {
        draft.error = null;
        try {
          await client.post(
            '/reviews',
            buildReviewBody({
              orderItemId: item.orderItemId,
              rating: draft.rating,
              title: draft.title,
              comment: draft.comment,
            })
          );
          reviewDrafts.delete(item.orderItemId);
          markSubmitted(item, item.product?.name ?? 'this item');
          draw();
        } catch (requestError) {
          draft.error = describeReviewError(requestError);
          errorNode.textContent = draft.error;
          errorNode.hidden = false;
        }
      })
    );

    const label = item.variantLabel
      ? `${item.product?.name ?? 'Item'} — ${item.variantLabel}`
      : (item.product?.name ?? 'Item');

    return el('div.review-form', {}, [
      el('p.review-form__product', { text: label }),
      el('fieldset.review-stars', {}, [
        el('legend.review-stars__legend', { text: 'Your rating' }),
        ...starChoices,
      ]),
      titleInput,
      commentInput,
      errorNode,
      el('div.review-form__footer', {}, [submit.element]),
    ]);
  }

  /**
   * The review block on an order card: any thanks notes, then a form for each
   * delivered line that has not been reviewed. Returns null when there is
   * nothing to say, so an order with no reviewable items stays unchanged.
   */
  function reviewSection(order) {
    const items = reviewableByOrder.get(order.orderNumber) ?? [];
    const thanks = submittedByOrder.get(order.orderNumber) ?? [];
    if (items.length === 0 && thanks.length === 0) return null;

    return el('section.order-reviews', {}, [
      el('p.order-reviews__title', {
        text: items.length > 0 ? 'Rate your purchase' : 'Thanks for reviewing',
      }),
      ...thanks.map((name) =>
        el('p.form-alert.form-alert--success', {
          role: 'status',
          text: `Thanks — your review of ${name} is awaiting moderation.`,
        })
      ),
      ...items.map((item) => reviewForm(item)),
    ]);
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

      reviewSection(order),

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

  await loadReviewable();
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
