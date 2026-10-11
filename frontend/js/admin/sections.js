/**
 * Admin console — section views.
 *
 * One render function per section, dispatched from `renderSection`. Each takes
 * the shell context (`{ api, auth, host, navigate, reload }`) and paints into
 * `host`, returning a small controller so the shell can tear the previous
 * section down.
 *
 * Two shared ideas run through the whole file:
 *
 *   LIST SCREENS  fetch a page, render a table, render a pagination bar, and
 *                 let a filter or an action re-run the same `load()`.
 *   DETAIL SCREENS  fetch one record, render it, and re-run `load()` after a
 *                 mutation so the screen always shows what the server now
 *                 holds rather than a locally patched guess.
 *
 * The client never decides whether an action is allowed — the server does. This
 * file decides what is worth *offering* so an operator is not shown a button
 * whose only outcome is a 403.
 */
import { el, clear } from '../core/dom.js';
import { button } from '../components/ui/button.js';
import {
  formatMoney,
  formatDate,
  formatNumber,
  majorToMinor,
  minorToMajor,
} from '../utils/format.js';
import {
  orderItemsList,
  orderTotals,
  orderAddressBlock,
  orderPaymentBlock,
} from '../components/order/order-view.js';
import {
  card,
  statCard,
  toneBadge,
  sectionHeading,
  dataTable,
  emptyBlock,
  errorBlock,
  loadingBlock,
  filterBar,
  filterSelect,
  paginationBar,
  buildForm,
  openDialog,
  confirmDialog,
  notify,
} from './kit.js';
import {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PAYMENT_METHODS,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  CUSTOMER_STATUSES,
  REVIEW_STATUSES,
  ADJUSTMENT_TYPES,
  humanize,
  toneFor,
  formatAttributes,
  signedQuantity,
  orderTransitions,
  priceRangeLabel,
  statusLabel,
} from './helpers.js';

const PAGE_SIZE = 20;

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Clears the host and mounts a fresh section root. */
function sectionCanvas(ctx) {
  clear(ctx.host);
  const root = el('div.admin-section');
  ctx.host.append(root);
  return root;
}

/** A list screen: heading with actions, then a body the table is drawn into. */
function listShell(ctx, { title, description, actions = [] }) {
  const root = sectionCanvas(ctx);
  root.append(sectionHeading({ title, description, actions }));
  const body = el('div.admin-list');
  root.append(body);
  return { root, body };
}

/** A status badge for a domain. */
function badgeFor(domain, value) {
  return toneBadge(statusLabel(value), toneFor(domain, value));
}

/** A small action button bound for a table cell. */
function cellButton(options) {
  return button({ size: 'sm', variant: 'ghost', ...options }).element;
}

/** A search field plus an explicit Apply button, returned as two controls. */
function searchControls(label, placeholder, initial, onRun) {
  const input = el('input.admin-input', { type: 'search', placeholder });
  input.value = initial ?? '';
  const run = () => onRun(input.value.trim());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      run();
    }
  });
  const wrapper = el('label.admin-filter', {}, [
    el('span.admin-filter__label', { text: label }),
    input,
  ]);
  const apply = button({ label: 'Apply', size: 'sm', variant: 'secondary', onClick: run }).element;
  return [wrapper, apply];
}

/** A detail-screen heading with a back control, badges and actions. */
function detailHeader({ title, subtitle = null, badges = [], actions = [], onBack }) {
  return el('header.admin-detail-head', {}, [
    el('div.admin-detail-head__bar', {}, [
      onBack
        ? button({
            label: 'Back',
            variant: 'ghost',
            size: 'sm',
            icon: 'arrow-left',
            onClick: onBack,
          }).element
        : el('span'),
      el('div.admin-detail-head__actions', {}, actions),
    ]),
    el('div.admin-detail-head__main', {}, [
      el('div', {}, [
        el('h1.admin-detail-head__title', { text: title }),
        subtitle ? el('p.admin-detail-head__subtitle', { text: subtitle }) : null,
      ]),
      badges.length > 0 ? el('div.admin-detail-head__badges', {}, badges) : null,
    ]),
  ]);
}

/** Renders a list screen body from a loader that resolves `{ rows, pagination }`. */
function renderListBody({
  body,
  rows,
  pagination,
  error,
  onRetry,
  columns,
  emptyTitle,
  emptyDescription,
  caption,
  onPage,
}) {
  clear(body);
  if (error) {
    body.append(errorBlock(error, onRetry));
    return;
  }
  if (!loadingDone(rows)) return;
  if (rows.length === 0) {
    body.append(emptyBlock(emptyTitle, emptyDescription));
    return;
  }
  const table = dataTable({ columns, rows, caption });
  if (table) body.append(table);
  const pager = paginationBar(pagination, onPage);
  if (pager) body.append(pager);
}

// A tiny marker so `renderListBody` knows a load has produced a (possibly empty)
// array rather than being called before the first response. `null` means "not
// loaded yet".
function loadingDone(rows) {
  return Array.isArray(rows);
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

async function dashboard(ctx) {
  const root = sectionCanvas(ctx);
  root.append(
    sectionHeading({
      title: 'Dashboard',
      description:
        'Orders, revenue and stock at a glance. Figures are live from the store database.',
    })
  );
  const body = el('div.admin-dashboard');
  root.append(body);

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading the dashboard…'));
    let data;
    try {
      data = await ctx.api.getDashboard();
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }

    clear(body);
    body.append(
      el('div.stat-grid', {}, [
        statCard({
          label: 'Orders',
          value: formatNumber(data.orders.total),
          hint: `${formatNumber(data.orders.byStatus.pending)} pending`,
          icon: 'package',
        }),
        statCard({
          label: 'Paid revenue',
          value: formatMoney(data.orders.paidRevenue),
          hint: `Gross sales ${formatMoney(data.orders.grossSales)}`,
          tone: 'success',
          icon: 'banknote',
        }),
        statCard({
          label: 'Awaiting payment',
          value: formatMoney(data.orders.pendingPayment),
          hint: 'Not yet collected',
          tone: 'warning',
          icon: 'clock',
        }),
        statCard({
          label: 'Products',
          value: formatNumber(data.products.total),
          hint: `${formatNumber(data.products.active)} active · ${formatNumber(data.products.draft)} draft`,
          icon: 'tag',
        }),
        statCard({
          label: 'Low stock',
          value: formatNumber(data.lowStockCount),
          hint: 'At or below reorder level',
          tone: data.lowStockCount > 0 ? 'danger' : 'neutral',
          icon: 'alert-triangle',
        }),
        statCard({
          label: 'Customers',
          value: formatNumber(data.customers.total),
          hint: `${formatNumber(data.customers.suspended)} suspended`,
          icon: 'user',
        }),
        statCard({
          label: 'Pending reviews',
          value: formatNumber(data.pendingReviews),
          hint: 'Awaiting moderation',
          tone: data.pendingReviews > 0 ? 'warning' : 'neutral',
          icon: 'star',
        }),
      ])
    );

    body.append(
      card({
        title: 'Orders by status',
        body: el(
          'ul.stat-breakdown',
          { role: 'list' },
          Object.entries(data.orders.byStatus).map(([status, count]) =>
            el('li.stat-breakdown__row', {}, [
              badgeFor('ORDER', status.toUpperCase()),
              el('span.stat-breakdown__count', { text: formatNumber(count) }),
            ])
          )
        ),
      })
    );

    const recent = data.recentOrders ?? [];
    body.append(
      card({
        title: 'Recent orders',
        actions: [
          button({
            label: 'All orders',
            variant: 'ghost',
            size: 'sm',
            iconEnd: 'arrow-right',
            onClick: () => ctx.navigate('orders'),
          }).element,
        ],
        body:
          dataTable({
            rows: recent,
            rowKey: (row) => row.orderNumber,
            columns: [
              { key: 'orderNumber', label: 'Order' },
              { key: 'customerEmail', label: 'Customer' },
              { label: 'Status', render: (row) => badgeFor('ORDER', row.status) },
              { label: 'Payment', render: (row) => badgeFor('PAYMENT', row.paymentStatus) },
              { label: 'Total', align: 'right', render: (row) => formatMoney(row.total) },
              { label: 'Placed', render: (row) => formatDate(row.createdAt) },
            ],
          }) ?? emptyBlock('No orders yet.', 'Orders will appear here as customers place them.'),
      })
    );
  }

  await load();
  return { destroy: () => {} };
}

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

function productColumns(ctx, reload) {
  return [
    {
      label: 'Product',
      render: (row) =>
        el('div.admin-cell-main', {}, [
          el(
            'button.admin-link',
            { type: 'button', onClick: () => ctx.navigate('products', row.id) },
            [el('span.admin-cell-main__title', { text: row.name })]
          ),
          el('span.admin-cell-main__sub', { text: row.slug }),
        ]),
    },
    {
      label: 'Category',
      render: (row) => row.category?.name ?? '—',
    },
    { label: 'Type', render: (row) => humanize(row.productType) },
    { label: 'Status', render: (row) => badgeFor('PRODUCT', row.status) },
    {
      label: 'Variants',
      align: 'right',
      render: (row) =>
        `${formatNumber(row.activeVariantCount)} / ${formatNumber(row.variantCount)}`,
    },
    { label: 'Stock', align: 'right', render: (row) => formatNumber(row.totalStock) },
    { label: 'Price', align: 'right', render: (row) => priceRangeLabel(row, formatMoney) },
    {
      label: '',
      align: 'right',
      render: (row) =>
        el('div.admin-cell-actions', {}, [
          cellButton({
            label: 'Open',
            icon: 'arrow-right',
            iconOnly: true,
            onClick: () => ctx.navigate('products', row.id),
          }),
          row.status === 'ARCHIVED'
            ? null
            : cellButton({
                label: 'Archive',
                icon: 'trash',
                iconOnly: true,
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: 'Archive product',
                    message: `Archive "${row.name}"? It disappears from the store but stays in past orders.`,
                    confirmLabel: 'Archive',
                  });
                  if (!ok) return;
                  try {
                    await ctx.api.archiveProduct(row.id);
                    notify(`"${row.name}" archived.`, 'success');
                    reload();
                  } catch (error) {
                    notify(error.message, 'error');
                  }
                },
              }),
        ]),
    },
  ];
}

async function categoryOptions(ctx, { includeNone = true, excludeId = null } = {}) {
  let categories;
  try {
    ({ categories } = await ctx.api.listCategories());
  } catch {
    categories = [];
  }
  const options = categories
    .filter((category) => category.id !== excludeId)
    .map((category) => ({ value: category.id, label: category.name }));
  if (includeNone) options.unshift({ value: '', label: 'No category' });
  return options;
}

async function openProductForm(ctx, { product = null, onSaved } = {}) {
  const options = await categoryOptions(ctx, { excludeId: product?.id ?? null });
  const isEdit = Boolean(product);

  const form = buildForm(
    [
      { name: 'name', label: 'Name', required: true, value: product?.name ?? '' },
      {
        name: 'slug',
        label: 'Slug',
        value: product?.slug ?? '',
        hint: 'Leave blank to derive from the name.',
        optional: true,
      },
      {
        name: 'productType',
        label: 'Product type',
        type: 'select',
        options: PRODUCT_TYPES.map((value) => ({ value, label: humanize(value) })),
        value: product?.productType ?? 'PHYSICAL',
      },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        options: PRODUCT_STATUSES.map((value) => ({ value, label: humanize(value) })),
        value: product?.status ?? 'DRAFT',
      },
      { name: 'brand', label: 'Brand', value: product?.brand ?? '', optional: true },
      {
        name: 'categoryId',
        label: 'Category',
        type: 'select',
        options,
        value: product?.category?.id ?? '',
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        value: product?.description ?? '',
        optional: true,
      },
    ],
    {
      submitLabel: isEdit ? 'Save product' : 'Create product',
      onSubmit: async (values) => {
        const payload = {
          name: values.name,
          productType: values.productType,
          status: values.status,
          categoryId: values.categoryId === '' ? null : values.categoryId,
          ...(values.slug ? { slug: values.slug } : {}),
          ...(values.brand ? { brand: values.brand } : {}),
          ...(values.description ? { description: values.description } : {}),
        };
        if (isEdit) await ctx.api.updateProduct(product.id, payload);
        else await ctx.api.createProduct(payload);
        dialog.close();
        notify(isEdit ? 'Product saved.' : 'Product created.', 'success');
        onSaved?.();
      },
    }
  );

  const dialog = openDialog({
    title: isEdit ? 'Edit product' : 'New product',
    content: form.element,
    size: 'lg',
  });
}

async function productList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Products',
    description: 'Create, edit and archive products, variants and images.',
  });
  const state = { page: 1, search: '', status: '', productType: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading products…'));
    let result;
    try {
      result = await ctx.api.listProducts({
        page: state.page,
        limit: PAGE_SIZE,
        search: state.search || undefined,
        status: state.status || undefined,
        productType: state.productType || undefined,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.products;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      columns: productColumns(ctx, load),
      emptyTitle: 'No products found',
      emptyDescription: 'Try clearing the filters, or create the first product.',
      caption: 'Products',
      onPage: (page) => {
        state.page = page;
        load();
      },
    });
  }

  const filters = filterBar([
    ...searchControls('Search', 'Name or slug…', state.search, (value) => {
      state.search = value;
      state.page = 1;
      load();
    }),
    filterSelect({
      label: 'Status',
      value: state.status,
      options: [
        { value: '', label: 'All statuses' },
        ...PRODUCT_STATUSES.map((value) => ({ value, label: humanize(value) })),
      ],
      onChange: (value) => {
        state.status = value;
        state.page = 1;
        load();
      },
    }),
    filterSelect({
      label: 'Type',
      value: state.productType,
      options: [
        { value: '', label: 'All types' },
        ...PRODUCT_TYPES.map((value) => ({ value, label: humanize(value) })),
      ],
      onChange: (value) => {
        state.productType = value;
        state.page = 1;
        load();
      },
    }),
  ]);

  body.before(filters);
  filters.after(
    el('div.admin-toolbar', {}, [
      button({
        label: 'New product',
        variant: 'primary',
        icon: 'plus',
        onClick: () => openProductForm(ctx, { onSaved: load }),
      }).element,
    ])
  );

  await load();
  return { destroy: () => {} };
}

async function productDetail(ctx, productId) {
  const root = sectionCanvas(ctx);

  async function load() {
    clear(root);
    root.append(loadingBlock('Loading product…'));
    let product;
    try {
      product = await ctx.api.getProduct(productId);
    } catch (error) {
      clear(root);
      root.append(errorBlock(error, load));
      return;
    }
    render(product);
  }

  function render(product) {
    clear(root);
    root.append(
      detailHeader({
        title: product.name,
        subtitle: product.slug,
        onBack: () => ctx.navigate('products'),
        badges: [
          badgeFor('PRODUCT', product.status),
          toneBadge(humanize(product.productType), 'info'),
        ],
        actions: [
          button({
            label: 'Edit product',
            variant: 'secondary',
            size: 'sm',
            icon: 'pencil',
            onClick: () => openProductForm(ctx, { product, onSaved: load }),
          }).element,
          product.status === 'ARCHIVED'
            ? null
            : button({
                label: 'Archive',
                variant: 'danger-ghost',
                size: 'sm',
                icon: 'trash',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: 'Archive product',
                    message: `Archive "${product.name}"? It will be hidden from the store.`,
                    confirmLabel: 'Archive',
                  });
                  if (!ok) return;
                  try {
                    await ctx.api.archiveProduct(product.id);
                    notify('Product archived.', 'success');
                    load();
                  } catch (error) {
                    notify(error.message, 'error');
                  }
                },
              }).element,
        ],
      })
    );

    root.append(
      card({
        title: 'Details',
        body: el('dl.admin-facts', {}, [
          fact('Category', product.category?.name ?? 'None'),
          fact('Brand', product.brand ?? '—'),
          fact(
            'Variants',
            `${formatNumber(product.activeVariantCount)} active of ${formatNumber(product.variantCount)}`
          ),
          fact(
            'Tracked stock',
            product.inventoryTracked ? formatNumber(product.totalStock) : 'Not tracked'
          ),
          fact('Price range', priceRangeLabel(product, formatMoney)),
          fact('Updated', formatDate(product.updatedAt)),
        ]),
      })
    );

    root.append(variantsCard(ctx, product, load));
    root.append(imagesCard(ctx, product, load));
  }

  function variantsCard(ctx, product, reload) {
    const columns = [
      { key: 'sku', label: 'SKU' },
      { label: 'Attributes', render: (row) => formatAttributes(row.attributes) },
      { label: 'Price', align: 'right', render: (row) => formatMoney(row.price) },
      {
        label: 'Compare at',
        align: 'right',
        render: (row) => (row.compareAtPrice ? formatMoney(row.compareAtPrice) : '—'),
      },
      {
        label: 'Stock',
        align: 'right',
        render: (row) => (row.inventory ? formatNumber(row.inventory.available) : '—'),
      },
      {
        label: 'Active',
        render: (row) =>
          toneBadge(row.isActive ? 'Active' : 'Inactive', row.isActive ? 'success' : 'neutral'),
      },
      {
        label: '',
        align: 'right',
        render: (row) =>
          el('div.admin-cell-actions', {}, [
            cellButton({
              label: 'Edit variant',
              icon: 'pencil',
              iconOnly: true,
              onClick: () => openVariantForm(ctx, { product, variant: row, onSaved: reload }),
            }),
            row.isActive
              ? cellButton({
                  label: 'Deactivate variant',
                  icon: 'x-circle',
                  iconOnly: true,
                  onClick: async () => {
                    const ok = await confirmDialog({
                      title: 'Deactivate variant',
                      message: `Deactivate ${row.sku}? It stays for order history but cannot be bought.`,
                      confirmLabel: 'Deactivate',
                    });
                    if (!ok) return;
                    try {
                      await ctx.api.deactivateVariant(row.id);
                      notify('Variant deactivated.', 'success');
                      reload();
                    } catch (error) {
                      notify(error.message, 'error');
                    }
                  },
                })
              : null,
          ]),
      },
    ];

    const table = dataTable({ columns, rows: product.variants });
    return card({
      title: 'Variants',
      description: product.inventoryTracked ? null : 'This product is not stock-tracked.',
      actions: [
        button({
          label: 'Add variant',
          variant: 'secondary',
          size: 'sm',
          icon: 'plus',
          onClick: () => openVariantForm(ctx, { product, variant: null, onSaved: reload }),
        }).element,
      ],
      body:
        table ?? emptyBlock('No variants yet.', 'Add the first variant to set a price and SKU.'),
    });
  }

  function imagesCard(ctx, product, reload) {
    const body =
      product.images.length === 0
        ? emptyBlock('No images yet.', 'Images are added by URL.')
        : el(
            'ul.admin-gallery',
            { role: 'list' },
            product.images.map((image) =>
              el('li.admin-gallery__item', { dataset: { primary: image.isPrimary } }, [
                el('div.admin-gallery__media', {}, [
                  el('img', {
                    src: image.imageUrl,
                    alt: image.altText ?? product.name,
                    loading: 'lazy',
                  }),
                ]),
                el('div.admin-gallery__body', {}, [
                  el('p.admin-gallery__url', { text: image.imageUrl }),
                  el('p.admin-gallery__alt', { text: image.altText ?? 'No alt text' }),
                  image.isPrimary ? toneBadge('Primary', 'success') : null,
                ]),
                el('div.admin-gallery__actions', {}, [
                  image.isPrimary
                    ? null
                    : cellButton({
                        label: 'Set primary',
                        icon: 'check',
                        iconOnly: true,
                        onClick: async () => {
                          try {
                            await ctx.api.updateImage(image.id, { isPrimary: true });
                            notify('Primary image updated.', 'success');
                            reload();
                          } catch (error) {
                            notify(error.message, 'error');
                          }
                        },
                      }),
                  cellButton({
                    label: 'Remove image',
                    icon: 'trash',
                    iconOnly: true,
                    onClick: async () => {
                      const ok = await confirmDialog({
                        title: 'Remove image',
                        message: 'Remove this image from the product?',
                        confirmLabel: 'Remove',
                      });
                      if (!ok) return;
                      try {
                        await ctx.api.deleteImage(image.id);
                        notify('Image removed.', 'success');
                        reload();
                      } catch (error) {
                        notify(error.message, 'error');
                      }
                    },
                  }),
                ]),
              ])
            )
          );

    return card({
      title: 'Images',
      description: 'Images are stored as URLs.',
      actions: [
        button({
          label: 'Add image',
          variant: 'secondary',
          size: 'sm',
          icon: 'image',
          onClick: () => openImageForm(ctx, { product, onSaved: reload }),
        }).element,
      ],
      body,
    });
  }

  await load();
  return { destroy: () => {} };
}

function fact(term, value) {
  return el('div.admin-facts__row', {}, [el('dt', { text: term }), el('dd', { text: value })]);
}

async function openVariantForm(ctx, { product, variant, onSaved }) {
  const isEdit = Boolean(variant);
  const form = buildForm(
    [
      { name: 'sku', label: 'SKU', required: true, value: variant?.sku ?? '' },
      {
        name: 'price',
        label: 'Price (ETB)',
        type: 'number',
        required: true,
        attrs: { step: '0.01', min: '0' },
        value: variant ? minorToMajor(variant.price) : '',
      },
      {
        name: 'compareAtPrice',
        label: 'Compare-at price (ETB)',
        type: 'number',
        optional: true,
        attrs: { step: '0.01', min: '0' },
        hint: 'The "was" price. Must be above the price.',
        value: variant?.compareAtPrice ? minorToMajor(variant.compareAtPrice) : '',
      },
      {
        name: 'attributes',
        label: 'Attributes',
        type: 'textarea',
        rows: 3,
        optional: true,
        hint: 'One per line, "Key: value". e.g. Colour: Black',
        value: attributesToText(variant?.attributes),
      },
      {
        name: 'isActive',
        label: 'Active',
        type: 'checkbox',
        value: variant ? variant.isActive : true,
      },
    ],
    {
      submitLabel: isEdit ? 'Save variant' : 'Add variant',
      onSubmit: async (values) => {
        const payload = {
          sku: values.sku,
          price: majorToMinor(values.price ?? 0),
          attributes: textToAttributes(values.attributes),
          isActive: values.isActive,
        };
        if (
          values.compareAtPrice !== undefined &&
          values.compareAtPrice !== null &&
          values.compareAtPrice !== ''
        ) {
          payload.compareAtPrice = majorToMinor(values.compareAtPrice);
        }
        if (isEdit) await ctx.api.updateVariant(variant.id, payload);
        else await ctx.api.createVariant(product.id, payload);
        dialog.close();
        notify(isEdit ? 'Variant saved.' : 'Variant added.', 'success');
        onSaved?.();
      },
    }
  );

  const dialog = openDialog({
    title: isEdit ? `Edit variant ${variant.sku}` : 'Add variant',
    content: form.element,
    size: 'lg',
  });
}

function attributesToText(attributes) {
  if (!attributes || typeof attributes !== 'object') return '';
  return Object.entries(attributes)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');
}

function textToAttributes(text) {
  const result = {};
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(':');
    if (separator === -1) {
      result[trimmed] = '';
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

async function openImageForm(ctx, { product, onSaved }) {
  const form = buildForm(
    [
      {
        name: 'imageUrl',
        label: 'Image URL',
        type: 'url',
        required: true,
        attrs: { placeholder: 'https://…' },
      },
      { name: 'altText', label: 'Alt text', optional: true },
      {
        name: 'sortOrder',
        label: 'Sort order',
        type: 'number',
        optional: true,
        attrs: { min: '0' },
      },
      { name: 'isPrimary', label: 'Make primary', type: 'checkbox', value: false },
    ],
    {
      submitLabel: 'Add image',
      onSubmit: async (values) => {
        const payload = {
          imageUrl: values.imageUrl,
          isPrimary: values.isPrimary,
        };
        if (values.altText) payload.altText = values.altText;
        if (
          values.sortOrder !== undefined &&
          values.sortOrder !== null &&
          values.sortOrder !== ''
        ) {
          payload.sortOrder = values.sortOrder;
        }
        await ctx.api.createImage(product.id, payload);
        dialog.close();
        notify('Image added.', 'success');
        onSaved?.();
      },
    }
  );

  const dialog = openDialog({ title: 'Add image', content: form.element });
}

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

async function openCategoryForm(ctx, { category = null, categories = [], onSaved } = {}) {
  const isEdit = Boolean(category);
  const parentOptions = [
    { value: '', label: 'No parent (top level)' },
    ...categories
      .filter((entry) => entry.id !== category?.id)
      .map((entry) => ({ value: entry.id, label: entry.name })),
  ];

  const form = buildForm(
    [
      { name: 'name', label: 'Name', required: true, value: category?.name ?? '' },
      {
        name: 'slug',
        label: 'Slug',
        optional: true,
        value: category?.slug ?? '',
        hint: 'Leave blank to derive from the name.',
      },
      {
        name: 'parentId',
        label: 'Parent',
        type: 'select',
        options: parentOptions,
        value: category?.parentId ?? '',
      },
      {
        name: 'sortOrder',
        label: 'Sort order',
        type: 'number',
        optional: true,
        attrs: { min: '0' },
        value: category?.sortOrder ?? 0,
      },
      { name: 'imageUrl', label: 'Image URL', optional: true, value: category?.imageUrl ?? '' },
      {
        name: 'isActive',
        label: 'Active',
        type: 'checkbox',
        value: category ? category.isActive : true,
      },
      {
        name: 'description',
        label: 'Description',
        type: 'textarea',
        optional: true,
        value: category?.description ?? '',
      },
    ],
    {
      submitLabel: isEdit ? 'Save category' : 'Create category',
      onSubmit: async (values) => {
        const payload = {
          name: values.name,
          parentId: values.parentId === '' ? null : values.parentId,
          isActive: values.isActive,
          ...(values.slug ? { slug: values.slug } : {}),
          ...(values.description ? { description: values.description } : {}),
          ...(values.imageUrl ? { imageUrl: values.imageUrl } : {}),
          ...(values.sortOrder !== undefined && values.sortOrder !== null && values.sortOrder !== ''
            ? { sortOrder: values.sortOrder }
            : {}),
        };
        if (isEdit) await ctx.api.updateCategory(category.id, payload);
        else await ctx.api.createCategory(payload);
        dialog.close();
        notify(isEdit ? 'Category saved.' : 'Category created.', 'success');
        onSaved?.();
      },
    }
  );

  const dialog = openDialog({
    title: isEdit ? `Edit ${category.name}` : 'New category',
    description: isEdit ? null : 'A category can be nested under a parent.',
    content: form.element,
  });
}

async function categoryList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Categories',
    description: 'Organise products into a hierarchy. Cycles are rejected by the server.',
  });

  let categories = [];
  let tree = [];

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading categories…'));
    try {
      const result = await ctx.api.listCategories();
      categories = result.categories;
      tree = result.tree;
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    draw();
  }

  function draw() {
    clear(body);
    if (tree.length === 0) {
      body.append(
        emptyBlock('No categories yet.', 'Create a category to start organising products.')
      );
    } else {
      body.append(
        el(
          'ul.admin-tree',
          { role: 'list' },
          tree.map((node) => treeNode(node, 0))
        )
      );
    }
  }

  function treeNode(node, depth) {
    return el('li.admin-tree__node', {}, [
      el('div.admin-tree__row', { style: `--depth:${depth}` }, [
        el('div.admin-tree__main', {}, [
          el('span.admin-tree__name', { text: node.name }),
          el('span.admin-tree__slug', { text: node.slug }),
        ]),
        el('div.admin-tree__meta', {}, [
          toneBadge(node.isActive ? 'Active' : 'Inactive', node.isActive ? 'success' : 'neutral'),
          el('span.admin-tree__count', {
            text: `${formatNumber(node.totalProductCount)} products`,
          }),
        ]),
        el('div.admin-cell-actions', {}, [
          cellButton({
            label: 'Add child',
            icon: 'plus',
            iconOnly: true,
            onClick: () => openCategoryForm(ctx, { categories, onSaved: load }),
          }),
          cellButton({
            label: 'Edit category',
            icon: 'pencil',
            iconOnly: true,
            onClick: () => openCategoryForm(ctx, { category: node, categories, onSaved: load }),
          }),
          node.isActive
            ? cellButton({
                label: 'Archive category',
                icon: 'trash',
                iconOnly: true,
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: 'Archive category',
                    message: `Archive "${node.name}"? Products keep their category but it is hidden from the store.`,
                    confirmLabel: 'Archive',
                  });
                  if (!ok) return;
                  try {
                    await ctx.api.archiveCategory(node.id);
                    notify('Category archived.', 'success');
                    load();
                  } catch (error) {
                    notify(error.message, 'error');
                  }
                },
              })
            : null,
        ]),
      ]),
      node.children.length > 0
        ? el(
            'ul.admin-tree',
            { role: 'list' },
            node.children.map((child) => treeNode(child, depth + 1))
          )
        : null,
    ]);
  }

  const toolbar = el('div.admin-toolbar', {}, [
    button({
      label: 'New category',
      variant: 'primary',
      icon: 'plus',
      onClick: () => openCategoryForm(ctx, { categories, onSaved: load }),
    }).element,
  ]);
  body.before(toolbar);

  await load();
  return { destroy: () => {} };
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                   */
/* -------------------------------------------------------------------------- */

async function openAdjustDialog(ctx, { item, onSaved }) {
  const form = buildForm(
    [
      {
        name: 'type',
        label: 'Movement',
        type: 'select',
        options: ADJUSTMENT_TYPES.map((value) => ({ value, label: humanize(value) })),
        value: 'RESTOCK',
      },
      { name: 'quantity', label: 'Quantity', type: 'number', required: true, attrs: { step: '1' } },
      { name: 'note', label: 'Note', type: 'textarea', rows: 2, optional: true },
    ],
    {
      submitLabel: 'Apply adjustment',
      onSubmit: async (values) => {
        await ctx.api.adjustInventory(item.variantId, {
          type: values.type,
          quantity: values.quantity,
          ...(values.note ? { note: values.note } : {}),
        });
        dialog.close();
        notify(`Stock updated for ${item.sku}.`, 'success');
        onSaved?.();
      },
    }
  );

  const dialog = openDialog({
    title: `Adjust stock · ${item.sku}`,
    description: item.product.name,
    content: form.element,
  });
}

async function openReorderDialog(ctx, { item, onSaved }) {
  const form = buildForm(
    [
      {
        name: 'reorderLevel',
        label: 'Reorder level',
        type: 'number',
        required: true,
        attrs: { min: '0', step: '1' },
        value: item.reorderLevel,
      },
    ],
    {
      submitLabel: 'Save reorder level',
      onSubmit: async (values) => {
        await ctx.api.updateReorderLevel(item.variantId, { reorderLevel: values.reorderLevel });
        dialog.close();
        notify('Reorder level saved.', 'success');
        onSaved?.();
      },
    }
  );

  const dialog = openDialog({ title: `Reorder level · ${item.sku}`, content: form.element });
}

async function openLedgerDialog(ctx, { item }) {
  const container = el('div.admin-ledger', {}, [loadingBlock('Loading the ledger…')]);
  const dialog = openDialog({
    title: `Stock ledger · ${item.sku}`,
    description: item.product.name,
    content: container,
    size: 'lg',
  });

  try {
    const { entries } = await ctx.api.getLedger(item.variantId, { limit: 50 });
    const table = dataTable({
      rows: entries,
      rowKey: (row) => row.id,
      columns: [
        { label: 'When', render: (row) => formatDate(row.createdAt) },
        { label: 'Movement', render: (row) => badgeFor('INVENTORY', row.type) },
        { label: 'Change', align: 'right', render: (row) => signedQuantity(row.quantity) },
        { label: 'Reference', render: (row) => row.referenceType ?? '—' },
        { label: 'Note', render: (row) => row.note ?? '—' },
        { label: 'By', render: (row) => row.createdBy?.name ?? '—' },
      ],
    });
    clear(container);
    container.append(table ?? emptyBlock('No stock movements recorded yet.'));
  } catch (error) {
    clear(container);
    container.append(errorBlock(error, () => dialog.close()));
  }
}

async function inventoryList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Inventory',
    description:
      'Every manual change writes a ledger entry. Adjustments cannot take stock below zero.',
  });
  const state = { page: 1, search: '', lowStock: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading inventory…'));
    let result;
    try {
      result = await ctx.api.listInventory({
        page: state.page,
        limit: PAGE_SIZE,
        search: state.search || undefined,
        lowStock: state.lowStock === '' ? undefined : state.lowStock,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.items;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      emptyTitle: 'No tracked variants',
      emptyDescription: 'Only stock-tracked (physical) variants appear here.',
      caption: 'Inventory',
      onPage: (page) => {
        state.page = page;
        load();
      },
      columns: [
        {
          label: 'Variant',
          render: (row) =>
            el('div.admin-cell-main', {}, [
              el('span.admin-cell-main__title', { text: row.sku }),
              el('span.admin-cell-main__sub', { text: row.product.name }),
            ]),
        },
        { label: 'Attributes', render: (row) => formatAttributes(row.attributes) },
        { label: 'On hand', align: 'right', render: (row) => formatNumber(row.quantity) },
        { label: 'Reserved', align: 'right', render: (row) => formatNumber(row.reservedQuantity) },
        { label: 'Available', align: 'right', render: (row) => formatNumber(row.available) },
        { label: 'Reorder at', align: 'right', render: (row) => formatNumber(row.reorderLevel) },
        {
          label: '',
          render: (row) => (row.isLowStock ? toneBadge('Low stock', 'warning') : ''),
        },
        {
          label: '',
          align: 'right',
          render: (row) =>
            el('div.admin-cell-actions', {}, [
              cellButton({
                label: 'Adjust stock',
                icon: 'plus',
                iconOnly: true,
                onClick: () => openAdjustDialog(ctx, { item: row, onSaved: load }),
              }),
              cellButton({
                label: 'Reorder level',
                icon: 'ruler',
                iconOnly: true,
                onClick: () => openReorderDialog(ctx, { item: row, onSaved: load }),
              }),
              cellButton({
                label: 'View ledger',
                icon: 'layers',
                iconOnly: true,
                onClick: () => openLedgerDialog(ctx, { item: row }),
              }),
            ]),
        },
      ],
    });
  }

  const filters = filterBar([
    ...searchControls('Search', 'SKU or product…', state.search, (value) => {
      state.search = value;
      state.page = 1;
      load();
    }),
    filterSelect({
      label: 'Stock',
      value: state.lowStock,
      options: [
        { value: '', label: 'All' },
        { value: 'true', label: 'Low stock only' },
      ],
      onChange: (value) => {
        state.lowStock = value;
        state.page = 1;
        load();
      },
    }),
  ]);
  body.before(filters);

  await load();
  return { destroy: () => {} };
}

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

async function orderList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Orders',
    description: 'Search, inspect and advance orders through the fulfilment lifecycle.',
  });
  const state = { page: 1, search: '', status: '', paymentStatus: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading orders…'));
    let result;
    try {
      result = await ctx.api.listOrders({
        page: state.page,
        limit: PAGE_SIZE,
        search: state.search || undefined,
        status: state.status || undefined,
        paymentStatus: state.paymentStatus || undefined,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.orders;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      emptyTitle: 'No orders found',
      emptyDescription: 'Try a different search or filter.',
      caption: 'Orders',
      onPage: (page) => {
        state.page = page;
        load();
      },
      columns: [
        {
          label: 'Order',
          render: (row) =>
            el(
              'button.admin-link',
              { type: 'button', onClick: () => ctx.navigate('orders', row.orderNumber) },
              [el('span.admin-cell-main__title', { text: row.orderNumber })]
            ),
        },
        { label: 'Customer', render: (row) => row.customer.email },
        { label: 'Status', render: (row) => badgeFor('ORDER', row.status) },
        { label: 'Payment', render: (row) => badgeFor('PAYMENT', row.paymentStatus) },
        { label: 'Total', align: 'right', render: (row) => formatMoney(row.total) },
        { label: 'Placed', render: (row) => formatDate(row.createdAt) },
        {
          label: '',
          align: 'right',
          render: (row) =>
            cellButton({
              label: 'Open order',
              icon: 'arrow-right',
              iconOnly: true,
              onClick: () => ctx.navigate('orders', row.orderNumber),
            }),
        },
      ],
    });
  }

  const filters = filterBar([
    ...searchControls('Search', 'Order number, email or phone…', state.search, (value) => {
      state.search = value;
      state.page = 1;
      load();
    }),
    filterSelect({
      label: 'Status',
      value: state.status,
      options: [
        { value: '', label: 'All statuses' },
        ...ORDER_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
      ],
      onChange: (value) => {
        state.status = value;
        state.page = 1;
        load();
      },
    }),
    filterSelect({
      label: 'Payment',
      value: state.paymentStatus,
      options: [
        { value: '', label: 'All payments' },
        ...PAYMENT_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
      ],
      onChange: (value) => {
        state.paymentStatus = value;
        state.page = 1;
        load();
      },
    }),
  ]);
  body.before(filters);

  await load();
  return { destroy: () => {} };
}

async function orderDetail(ctx, orderNumber) {
  const root = sectionCanvas(ctx);

  async function load() {
    clear(root);
    root.append(loadingBlock('Loading order…'));
    let order;
    try {
      order = await ctx.api.getOrder(orderNumber);
    } catch (error) {
      clear(root);
      root.append(errorBlock(error, load));
      return;
    }
    render(order);
  }

  function render(order) {
    clear(root);
    const transitions = orderTransitions(order.status);

    root.append(
      detailHeader({
        title: order.orderNumber,
        subtitle: `${formatDate(order.placedAt)} · ${formatMoney(order.total)}`,
        onBack: () => ctx.navigate('orders'),
        badges: [badgeFor('ORDER', order.status), badgeFor('PAYMENT', order.paymentStatus)],
        actions: transitions.length
          ? transitions.map(
              (target) =>
                button({
                  label: `Mark ${statusLabel(target)}`,
                  variant: target === 'CANCELLED' ? 'danger-ghost' : 'primary',
                  size: 'sm',
                  onClick: () => openStatusTransition(ctx, { order, target, onDone: load }),
                }).element
            )
          : [],
      })
    );

    root.append(
      el('div.admin-detail-grid', {}, [
        card({
          title: 'Items',
          body: [orderItemsList(order.items), orderTotals(order)],
        }),
        card({
          title: 'Customer',
          body: el('dl.admin-facts', {}, [
            fact('Name', order.customer.name || '—'),
            fact('Email', order.customer.email || '—'),
            fact('Phone', order.customer.phone || '—'),
          ]),
        }),
        card({
          title: 'Delivery',
          body: orderAddressBlock(order.shippingAddress) ?? emptyBlock('No address on this order.'),
        }),
        card({ title: 'Payment', body: orderPaymentBlock(order) }),
      ])
    );
  }

  await load();
  return { destroy: () => {} };
}

async function openStatusTransition(ctx, { order, target, onDone }) {
  const destructive = target === 'CANCELLED';
  const ok = await confirmDialog({
    title: `Mark order ${statusLabel(target)}`,
    message: destructive
      ? 'Cancelling returns every tracked item to stock. This cannot be undone.'
      : `Move ${order.orderNumber} from ${statusLabel(order.status)} to ${statusLabel(target)}?`,
    confirmLabel: destructive ? 'Cancel order' : `Mark ${statusLabel(target)}`,
  });
  if (!ok) return;

  try {
    await ctx.api.updateOrderStatus(order.orderNumber, { status: target });
    notify(`Order ${order.orderNumber} is now ${statusLabel(target)}.`, 'success');
    onDone();
  } catch (error) {
    notify(error.message, 'error');
  }
}

/* -------------------------------------------------------------------------- */
/* Customers                                                                   */
/* -------------------------------------------------------------------------- */

async function customerList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Customers',
    description: 'Search customers, review their history and manage account status.',
  });
  const state = { page: 1, search: '', status: '', role: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading customers…'));
    let result;
    try {
      result = await ctx.api.listCustomers({
        page: state.page,
        limit: PAGE_SIZE,
        search: state.search || undefined,
        status: state.status || undefined,
        role: state.role || undefined,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.customers;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      emptyTitle: 'No customers found',
      emptyDescription: 'Try a different search or filter.',
      caption: 'Customers',
      onPage: (page) => {
        state.page = page;
        load();
      },
      columns: [
        {
          label: 'Customer',
          render: (row) =>
            el(
              'button.admin-link',
              { type: 'button', onClick: () => ctx.navigate('customers', row.id) },
              [
                el('span.admin-cell-main__title', { text: row.name }),
                row.email ? el('span.admin-cell-main__sub', { text: row.email }) : null,
              ]
            ),
        },
        { label: 'Role', render: (row) => humanize(row.role) },
        { label: 'Status', render: (row) => badgeFor('CUSTOMER', row.status) },
        { label: 'Orders', align: 'right', render: (row) => formatNumber(row.orderCount) },
        { label: 'Spent', align: 'right', render: (row) => formatMoney(row.totalSpent) },
        {
          label: 'Last login',
          render: (row) => (row.lastLoginAt ? formatDate(row.lastLoginAt) : '—'),
        },
        {
          label: '',
          align: 'right',
          render: (row) =>
            cellButton({
              label: 'Open customer',
              icon: 'arrow-right',
              iconOnly: true,
              onClick: () => ctx.navigate('customers', row.id),
            }),
        },
      ],
    });
  }

  const filters = filterBar([
    ...searchControls('Search', 'Name, email or phone…', state.search, (value) => {
      state.search = value;
      state.page = 1;
      load();
    }),
    filterSelect({
      label: 'Status',
      value: state.status,
      options: [
        { value: '', label: 'All statuses' },
        ...CUSTOMER_STATUSES.map((value) => ({ value, label: humanize(value) })),
      ],
      onChange: (value) => {
        state.status = value;
        state.page = 1;
        load();
      },
    }),
    filterSelect({
      label: 'Role',
      value: state.role,
      options: [
        { value: '', label: 'All roles' },
        { value: 'CUSTOMER', label: 'Customer' },
        { value: 'ADMIN', label: 'Admin' },
        { value: 'SELLER', label: 'Seller' },
      ],
      onChange: (value) => {
        state.role = value;
        state.page = 1;
        load();
      },
    }),
  ]);
  body.before(filters);

  await load();
  return { destroy: () => {} };
}

async function customerDetail(ctx, customerId) {
  const root = sectionCanvas(ctx);

  async function load() {
    clear(root);
    root.append(loadingBlock('Loading customer…'));
    let customer;
    try {
      customer = await ctx.api.getCustomer(customerId);
    } catch (error) {
      clear(root);
      root.append(errorBlock(error, load));
      return;
    }
    render(customer);
  }

  function render(customer) {
    clear(root);
    const isCustomer = customer.role === 'CUSTOMER';
    const suspended = customer.status === 'SUSPENDED';

    root.append(
      detailHeader({
        title: customer.name,
        subtitle: customer.email,
        onBack: () => ctx.navigate('customers'),
        badges: [badgeFor('CUSTOMER', customer.status), toneBadge(humanize(customer.role), 'info')],
        actions: isCustomer
          ? [
              button({
                label: suspended ? 'Reactivate account' : 'Suspend account',
                variant: suspended ? 'primary' : 'danger-ghost',
                size: 'sm',
                onClick: async () => {
                  const ok = await confirmDialog({
                    title: suspended ? 'Reactivate account' : 'Suspend account',
                    message: suspended
                      ? `Reactivate ${customer.name}? They will be able to sign in again.`
                      : `Suspend ${customer.name}? They will be signed out and cannot sign in.`,
                    confirmLabel: suspended ? 'Reactivate' : 'Suspend',
                  });
                  if (!ok) return;
                  try {
                    await ctx.api.updateCustomerStatus(customer.id, {
                      status: suspended ? 'ACTIVE' : 'SUSPENDED',
                    });
                    notify('Customer status updated.', 'success');
                    load();
                  } catch (error) {
                    notify(error.message, 'error');
                  }
                },
              }).element,
            ]
          : [],
      })
    );

    root.append(
      el('div.admin-detail-grid', {}, [
        card({
          title: 'Account',
          body: el('dl.admin-facts', {}, [
            fact('Email', customer.email || '—'),
            fact('Phone', customer.phone ?? '—'),
            fact('Role', humanize(customer.role)),
            fact('Orders', formatNumber(customer.orderCount)),
            fact('Total spent', formatMoney(customer.totalSpent)),
            fact('Cancelled orders', formatNumber(customer.cancelledCount)),
            fact('Joined', formatDate(customer.createdAt)),
            fact('Last login', customer.lastLoginAt ? formatDate(customer.lastLoginAt) : '—'),
          ]),
        }),
        card({
          title: 'Recent orders',
          body:
            dataTable({
              rows: customer.recentOrders ?? [],
              rowKey: (row) => row.orderNumber,
              columns: [
                { key: 'orderNumber', label: 'Order' },
                { label: 'Status', render: (row) => badgeFor('ORDER', row.status) },
                { label: 'Payment', render: (row) => badgeFor('PAYMENT', row.paymentStatus) },
                { label: 'Total', align: 'right', render: (row) => formatMoney(row.total) },
                { label: 'Placed', render: (row) => formatDate(row.createdAt) },
              ],
            }) ?? emptyBlock('No orders yet.'),
        }),
      ])
    );
  }

  await load();
  return { destroy: () => {} };
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

async function reviewList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Reviews',
    description:
      'Approve or reject customer reviews. Author text is never edited — moderation is recorded.',
  });
  const state = { page: 1, status: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading reviews…'));
    let result;
    try {
      result = await ctx.api.listReviews({
        page: state.page,
        limit: PAGE_SIZE,
        status: state.status || undefined,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.reviews;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      emptyTitle: 'No reviews found',
      emptyDescription: 'Try a different filter.',
      caption: 'Reviews',
      onPage: (page) => {
        state.page = page;
        load();
      },
      columns: [
        {
          label: 'Product',
          render: (row) =>
            el(
              'button.admin-link',
              { type: 'button', onClick: () => ctx.navigate('reviews', row.id) },
              [el('span.admin-cell-main__title', { text: row.product.name ?? '—' })]
            ),
        },
        { label: 'Reviewer', render: (row) => row.reviewer.name ?? row.reviewer.email ?? '—' },
        { label: 'Rating', render: (row) => `${formatNumber(row.rating)} / 5` },
        { label: 'Title', render: (row) => row.title ?? '—' },
        { label: 'Status', render: (row) => badgeFor('REVIEW', row.status) },
        { label: 'Submitted', render: (row) => formatDate(row.createdAt) },
        {
          label: '',
          align: 'right',
          render: (row) =>
            cellButton({
              label: 'Open review',
              icon: 'arrow-right',
              iconOnly: true,
              onClick: () => ctx.navigate('reviews', row.id),
            }),
        },
      ],
    });
  }

  const filters = filterBar([
    filterSelect({
      label: 'Status',
      value: state.status,
      options: [
        { value: '', label: 'All statuses' },
        ...REVIEW_STATUSES.map((value) => ({ value, label: humanize(value) })),
      ],
      onChange: (value) => {
        state.status = value;
        state.page = 1;
        load();
      },
    }),
  ]);
  body.before(filters);

  await load();
  return { destroy: () => {} };
}

async function reviewDetail(ctx, reviewId) {
  const root = sectionCanvas(ctx);

  async function load() {
    clear(root);
    root.append(loadingBlock('Loading review…'));
    let review;
    try {
      review = await ctx.api.getReview(reviewId);
    } catch (error) {
      clear(root);
      root.append(errorBlock(error, load));
      return;
    }
    render(review);
  }

  function render(review) {
    clear(root);
    root.append(
      detailHeader({
        title: review.title ?? 'Review',
        subtitle: review.product.name ?? '',
        onBack: () => ctx.navigate('reviews'),
        badges: [
          badgeFor('REVIEW', review.status),
          toneBadge(`${formatNumber(review.rating)} / 5`, 'info'),
        ],
        actions: [
          review.status !== 'APPROVED'
            ? button({
                label: 'Approve',
                variant: 'primary',
                size: 'sm',
                icon: 'check',
                onClick: () => moderate(ctx, review, 'APPROVED', load),
              }).element
            : null,
          review.status !== 'REJECTED'
            ? button({
                label: 'Reject',
                variant: 'danger-ghost',
                size: 'sm',
                icon: 'x-circle',
                onClick: () => moderate(ctx, review, 'REJECTED', load),
              }).element
            : null,
        ].filter(Boolean),
      })
    );

    root.append(
      el('div.admin-detail-grid', {}, [
        card({
          title: 'Review',
          body: el('div.admin-review', {}, [
            el('p.admin-review__meta', {
              text: `${review.reviewer.name ?? review.reviewer.email ?? 'Unknown'} · ${formatDate(review.createdAt)}`,
            }),
            review.comment
              ? el('p.admin-review__comment', { text: review.comment })
              : el('p.admin-review__comment', { text: 'No comment left.' }),
          ]),
        }),
        card({
          title: 'Moderation',
          body: review.moderation
            ? el('dl.admin-facts', {}, [
                fact('Moderator', review.moderation.moderatorName ?? review.moderation.moderatorId),
                fact('When', formatDate(review.moderation.moderatedAt)),
                fact('Note', review.moderation.note ?? '—'),
              ])
            : emptyBlock('Not yet moderated.'),
        }),
      ])
    );
  }

  await load();
  return { destroy: () => {} };
}

async function moderate(ctx, review, status, onDone) {
  const ok = await confirmDialog({
    title: status === 'APPROVED' ? 'Approve review' : 'Reject review',
    message:
      status === 'APPROVED'
        ? 'Approve this review so it shows on the product page?'
        : 'Reject this review? It will stay hidden from the store.',
    confirmLabel: status === 'APPROVED' ? 'Approve' : 'Reject',
    tone: status === 'APPROVED' ? 'primary' : 'danger',
  });
  if (!ok) return;
  try {
    await ctx.api.moderateReview(review.id, { status });
    notify(`Review ${status === 'APPROVED' ? 'approved' : 'rejected'}.`, 'success');
    onDone();
  } catch (error) {
    notify(error.message, 'error');
  }
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

async function paymentList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Payments',
    description:
      'Inspect payment status, method and transaction reference. No secrets are ever shown.',
  });
  const state = { page: 1, status: '', method: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading payments…'));
    let result;
    try {
      result = await ctx.api.listPayments({
        page: state.page,
        limit: PAGE_SIZE,
        status: state.status || undefined,
        method: state.method || undefined,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.payments;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      emptyTitle: 'No payments found',
      emptyDescription: 'Try a different filter.',
      caption: 'Payments',
      onPage: (page) => {
        state.page = page;
        load();
      },
      columns: [
        {
          label: 'Order',
          render: (row) =>
            el(
              'button.admin-link',
              { type: 'button', onClick: () => ctx.navigate('orders', row.order.orderNumber) },
              [el('span.admin-cell-main__title', { text: row.order.orderNumber ?? '—' })]
            ),
        },
        { label: 'Provider', render: (row) => row.provider },
        { label: 'Method', render: (row) => humanize(row.method) },
        { label: 'Status', render: (row) => badgeFor('PAYMENT', row.status) },
        { label: 'Amount', align: 'right', render: (row) => formatMoney(row.amount) },
        { label: 'Reference', render: (row) => row.transactionReference ?? '—' },
        { label: 'Created', render: (row) => formatDate(row.createdAt) },
        {
          label: '',
          align: 'right',
          render: (row) =>
            cellButton({
              label: 'Open payment',
              icon: 'arrow-right',
              iconOnly: true,
              onClick: () => ctx.navigate('payments', row.id),
            }),
        },
      ],
    });
  }

  const filters = filterBar([
    filterSelect({
      label: 'Status',
      value: state.status,
      options: [
        { value: '', label: 'All statuses' },
        ...PAYMENT_STATUSES.map((value) => ({ value, label: statusLabel(value) })),
      ],
      onChange: (value) => {
        state.status = value;
        state.page = 1;
        load();
      },
    }),
    filterSelect({
      label: 'Method',
      value: state.method,
      options: [
        { value: '', label: 'All methods' },
        ...PAYMENT_METHODS.map((value) => ({ value, label: humanize(value) })),
      ],
      onChange: (value) => {
        state.method = value;
        state.page = 1;
        load();
      },
    }),
  ]);
  body.before(filters);

  await load();
  return { destroy: () => {} };
}

async function paymentDetail(ctx, paymentId) {
  const root = sectionCanvas(ctx);

  async function load() {
    clear(root);
    root.append(loadingBlock('Loading payment…'));
    let payment;
    try {
      payment = await ctx.api.getPayment(paymentId);
    } catch (error) {
      clear(root);
      root.append(errorBlock(error, load));
      return;
    }
    render(payment);
  }

  function render(payment) {
    clear(root);
    root.append(
      detailHeader({
        title: `Payment ${payment.id.slice(0, 8)}`,
        subtitle: payment.order.orderNumber ?? '',
        onBack: () => ctx.navigate('payments'),
        badges: [badgeFor('PAYMENT', payment.status), toneBadge(humanize(payment.method), 'info')],
      })
    );

    root.append(
      el('div.admin-detail-grid', {}, [
        card({
          title: 'Payment',
          body: el('dl.admin-facts', {}, [
            fact('Provider', payment.provider),
            fact('Method', humanize(payment.method)),
            fact('Status', statusLabel(payment.status)),
            fact('Amount', formatMoney(payment.amount)),
            fact('Reference', payment.transactionReference ?? '—'),
            fact('Paid at', payment.paidAt ? formatDate(payment.paidAt) : '—'),
            fact('Failure reason', payment.failureReason ?? '—'),
            fact('Created', formatDate(payment.createdAt)),
          ]),
        }),
        card({
          title: 'Order',
          body: el('dl.admin-facts', {}, [
            fact('Order', payment.order.orderNumber ?? '—'),
            fact('Customer email', payment.order.customerEmail ?? '—'),
            fact('Customer phone', payment.order.customerPhone ?? '—'),
            fact('Order status', statusLabel(payment.order.status)),
            fact('Order payment', statusLabel(payment.order.paymentStatus)),
          ]),
        }),
      ])
    );
  }

  await load();
  return { destroy: () => {} };
}

/* -------------------------------------------------------------------------- */
/* Audit log                                                                   */
/* -------------------------------------------------------------------------- */

async function auditList(ctx) {
  const { body } = listShell(ctx, {
    title: 'Audit log',
    description:
      'A record of every sensitive administrative action, with the operator who took it.',
  });
  const state = { page: 1, entityType: '', action: '' };
  let rows = null;
  let pagination = null;

  async function load() {
    clear(body);
    body.append(loadingBlock('Loading the audit log…'));
    let result;
    try {
      result = await ctx.api.listAuditLogs({
        page: state.page,
        limit: PAGE_SIZE,
        entityType: state.entityType || undefined,
        action: state.action || undefined,
      });
    } catch (error) {
      clear(body);
      body.append(errorBlock(error, load));
      return;
    }
    rows = result.logs;
    pagination = result.pagination;
    draw();
  }

  function draw() {
    renderListBody({
      body,
      rows,
      pagination,
      emptyTitle: 'No audit entries',
      emptyDescription: 'Sensitive actions will be recorded here.',
      caption: 'Audit log',
      onPage: (page) => {
        state.page = page;
        load();
      },
      columns: [
        { label: 'When', render: (row) => formatDate(row.createdAt) },
        { label: 'Action', render: (row) => toneBadge(humanize(row.action), 'info') },
        { label: 'Entity', render: (row) => `${humanize(row.entityType)}` },
        { label: 'Summary', render: (row) => row.summary ?? '—' },
        { label: 'Actor', render: (row) => row.actor?.email ?? '—' },
      ],
    });
  }

  const filters = filterBar([
    filterSelect({
      label: 'Entity',
      value: state.entityType,
      options: [
        { value: '', label: 'All entities' },
        ...[
          'PRODUCT',
          'VARIANT',
          'IMAGE',
          'CATEGORY',
          'INVENTORY',
          'ORDER',
          'CUSTOMER',
          'REVIEW',
        ].map((value) => ({ value, label: humanize(value) })),
      ],
      onChange: (value) => {
        state.entityType = value;
        state.page = 1;
        load();
      },
    }),
  ]);
  body.before(filters);

  await load();
  return { destroy: () => {} };
}

/* -------------------------------------------------------------------------- */
/* Dispatch                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Renders the section named by the route into the shell's host.
 * @param {{ section: string, id: string|null }} route
 * @param {object} ctx
 */
export async function renderSection(route, ctx) {
  switch (route.section) {
    case 'products':
      return route.id ? productDetail(ctx, route.id) : productList(ctx);
    case 'categories':
      return categoryList(ctx);
    case 'inventory':
      return inventoryList(ctx);
    case 'orders':
      return route.id ? orderDetail(ctx, route.id) : orderList(ctx);
    case 'customers':
      return route.id ? customerDetail(ctx, route.id) : customerList(ctx);
    case 'reviews':
      return route.id ? reviewDetail(ctx, route.id) : reviewList(ctx);
    case 'payments':
      return route.id ? paymentDetail(ctx, route.id) : paymentList(ctx);
    case 'audit':
      return auditList(ctx);
    case 'dashboard':
    default:
      return dashboard(ctx);
  }
}

export default { renderSection };
