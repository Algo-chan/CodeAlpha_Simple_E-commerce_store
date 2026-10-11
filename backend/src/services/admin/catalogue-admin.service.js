/**
 * Catalogue administration — products, variants and images.
 *
 * WHAT THIS SERVICE IS RESPONSIBLE FOR
 *
 * The storefront catalogue repository only reads; this is the write side. The
 * rules the database enforces (unique slug, unique SKU, a "was" price above the
 * sale price, one primary image) are all checked here FIRST so a client gets a
 * clear 409 or 422 instead of a translated driver error, and the check and the
 * write happen in one transaction so a racing writer cannot slip between them.
 *
 * TWO DECISIONS WORTH REMEMBERING
 *
 *   Deleting is not offered for products or variants. `order_items` points at
 *   them with ON DELETE RESTRICT precisely so a sale cannot orphan history.
 *   "Remove this product" therefore means archive it, and it keeps rendering in
 *   every past order while disappearing from the store.
 *
 *   A newly created PHYSICAL variant gets a zeroed inventory row immediately.
 *   A missing inventory row means "not stock-tracked", which for a physical
 *   product would mean "infinitely available". Creating the row at once makes a
 *   brand-new variant correctly out of stock until it is restocked, which is the
 *   conservative default.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AUDIT_ACTION, AUDIT_ENTITY, PRODUCT_TYPE } from '../../config/constants.js';
import * as repo from '../../repositories/admin.repository.js';
import {
  toAdminProductDetail,
  toAdminProductListItem,
  toAdminVariant,
  toAdminImage,
} from '../admin.view.js';
import { recordAudit } from './audit.js';
import {
  conflict,
  notFound,
  paginationMeta,
  resolvePaging,
  resolveSlug,
  unprocessable,
} from './common.js';

/* -------------------------------------------------------------------------- */
/* Products                                                                    */
/* -------------------------------------------------------------------------- */

export async function listProducts(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = {
    search: query.search,
    status: query.status,
    productType: query.productType,
    categoryId: query.categoryId,
  };

  const { rows, total } = await repo.listAdminProducts(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    products: rows.map(toAdminProductListItem),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getProduct(db, id) {
  const product = await repo.findAdminProductById(db, id);
  if (!product) throw notFound('Product not found.');

  const [variants, images] = await Promise.all([
    repo.listVariantsByProduct(db, id),
    repo.listImagesByProduct(db, id),
  ]);

  return toAdminProductDetail({ product, variants, images });
}

/** Loads the product's detail view; shared by create and update. */
async function loadProductDetail(db, id) {
  const product = await repo.findAdminProductById(db, id);
  const [variants, images] = await Promise.all([
    repo.listVariantsByProduct(db, id),
    repo.listImagesByProduct(db, id),
  ]);
  return toAdminProductDetail({ product, variants, images });
}

/** Confirms a category id exists before a product or category references it. */
async function assertCategoryExists(db, categoryId) {
  if (categoryId === null || categoryId === undefined) return;
  const category = await repo.findAdminCategoryById(db, categoryId);
  if (!category) throw unprocessable('The referenced category does not exist.');
}

export async function createProduct(db, actor, input) {
  const slug = resolveSlug(input, input.name);

  return runInTransaction(db, async (tx) => {
    if (await repo.findAdminProductBySlug(tx, slug, {})) {
      throw conflict('A product with this slug already exists.');
    }
    await assertCategoryExists(tx, input.categoryId);

    const created = await repo.insertProduct(tx, {
      name: input.name,
      slug,
      description: input.description,
      productType: input.productType ?? PRODUCT_TYPE.PHYSICAL,
      brand: input.brand,
      categoryId: input.categoryId,
      status: input.status ?? 'DRAFT',
    });

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.PRODUCT_CREATED,
      entityType: AUDIT_ENTITY.PRODUCT,
      entityId: created.id,
      summary: `Created product "${input.name}" (${slug}).`,
      changes: { after: { name: input.name, slug, status: input.status ?? 'DRAFT' } },
    });

    return loadProductDetail(tx, created.id);
  });
}

export async function updateProduct(db, actor, id, input) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findAdminProductById(tx, id);
    if (!existing) throw notFound('Product not found.');

    if (input.slug && input.slug !== existing.slug) {
      if (await repo.findAdminProductBySlug(tx, input.slug, { excludeId: id })) {
        throw conflict('A product with this slug already exists.');
      }
    }
    if (input.categoryId !== undefined) await assertCategoryExists(tx, input.categoryId);

    await repo.updateProduct(tx, id, input);

    const changedKeys = Object.keys(input).filter((key) => key in input);
    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.PRODUCT_UPDATED,
      entityType: AUDIT_ENTITY.PRODUCT,
      entityId: id,
      summary: `Updated product "${existing.name}".`,
      changes: { fields: changedKeys },
    });

    return loadProductDetail(tx, id);
  });
}

/**
 * Archives a product. Archiving is idempotent: archiving an already-archived
 * product is a no-op that returns the current detail rather than an error, so a
 * double click is harmless.
 */
export async function archiveProduct(db, actor, id) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findAdminProductById(tx, id);
    if (!existing) throw notFound('Product not found.');

    if (existing.status !== 'ARCHIVED') {
      await repo.updateProduct(tx, id, { status: 'ARCHIVED' });
      await recordAudit(tx, actor, {
        action: AUDIT_ACTION.PRODUCT_ARCHIVED,
        entityType: AUDIT_ENTITY.PRODUCT,
        entityId: id,
        summary: `Archived product "${existing.name}".`,
        changes: { before: { status: existing.status }, after: { status: 'ARCHIVED' } },
      });
    }

    return loadProductDetail(tx, id);
  });
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                    */
/* -------------------------------------------------------------------------- */

export async function listVariants(db, productId) {
  const product = await repo.findAdminProductById(db, productId);
  if (!product) throw notFound('Product not found.');
  const rows = await repo.listVariantsByProduct(db, productId);
  return rows.map(toAdminVariant);
}

/**
 * Validates the "was" price rule the database also enforces:
 * compare_at_price, when present, must be strictly above the sale price.
 */
function assertComparePrice(price, compareAtPrice) {
  if (compareAtPrice === null || compareAtPrice === undefined) return;
  if (compareAtPrice <= price) {
    throw unprocessable('The compare-at price must be greater than the price.');
  }
}

export async function createVariant(db, actor, productId, input) {
  return runInTransaction(db, async (tx) => {
    const product = await repo.findAdminProductById(tx, productId);
    if (!product) throw notFound('Product not found.');

    if (await repo.findVariantBySku(tx, input.sku, {})) {
      throw conflict('A variant with this SKU already exists.');
    }
    assertComparePrice(input.price, input.compareAtPrice);

    const created = await repo.insertVariant(tx, {
      productId,
      sku: input.sku,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      attributes: input.attributes ?? {},
      isActive: input.isActive ?? true,
    });

    // A physical variant is stock-tracked from birth; see the file header.
    if (product.product_type === PRODUCT_TYPE.PHYSICAL) {
      await repo.ensureInventoryRow(tx, created.id);
    }

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.VARIANT_CREATED,
      entityType: AUDIT_ENTITY.VARIANT,
      entityId: created.id,
      summary: `Created variant ${input.sku} for "${product.name}".`,
      changes: { after: { sku: input.sku, price: input.price } },
    });

    const rows = await repo.listVariantsByProduct(tx, productId);
    return rows.map(toAdminVariant);
  });
}

export async function updateVariant(db, actor, variantId, input) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findVariantById(tx, variantId);
    if (!existing) throw notFound('Variant not found.');

    if (input.sku && input.sku !== existing.sku) {
      if (await repo.findVariantBySku(tx, input.sku, { excludeId: variantId })) {
        throw conflict('A variant with this SKU already exists.');
      }
    }

    const fields = { ...input };

    // The compare-at price must never end up at or below the new price. If the
    // caller did not explicitly set one and the (possibly raised) price would
    // violate the rule, the promotion is withdrawn by clearing the column, which
    // is exactly what migration 007 documents as required.
    const effectivePrice = input.price ?? Number(existing.price);
    if (input.compareAtPrice === undefined) {
      const currentCompare = existing.compare_at_price;
      if (currentCompare !== null && effectivePrice >= Number(currentCompare)) {
        fields.compareAtPrice = null;
      }
    } else {
      assertComparePrice(effectivePrice, input.compareAtPrice);
    }

    await repo.updateVariant(tx, variantId, fields);

    const changedKeys = Object.keys(input);
    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.VARIANT_UPDATED,
      entityType: AUDIT_ENTITY.VARIANT,
      entityId: variantId,
      summary: `Updated variant ${input.sku ?? existing.sku}.`,
      changes: {
        fields: changedKeys,
        before: { price: Number(existing.price), compareAtPrice: existing.compare_at_price },
        after: { price: effectivePrice, compareAtPrice: fields.compareAtPrice ?? null },
      },
    });

    const rows = await repo.listVariantsByProduct(tx, existing.product_id);
    return rows.map(toAdminVariant);
  });
}

export async function deactivateVariant(db, actor, variantId) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findVariantById(tx, variantId);
    if (!existing) throw notFound('Variant not found.');

    if (existing.is_active) {
      await repo.deactivateVariant(tx, variantId);
      await recordAudit(tx, actor, {
        action: AUDIT_ACTION.VARIANT_DEACTIVATED,
        entityType: AUDIT_ENTITY.VARIANT,
        entityId: variantId,
        summary: `Deactivated variant ${existing.sku}.`,
        changes: { before: { isActive: true }, after: { isActive: false } },
      });
    }

    const rows = await repo.listVariantsByProduct(tx, existing.product_id);
    return rows.map(toAdminVariant);
  });
}

/* -------------------------------------------------------------------------- */
/* Images                                                                      */
/* -------------------------------------------------------------------------- */

export async function listImages(db, productId) {
  const product = await repo.findAdminProductById(db, productId);
  if (!product) throw notFound('Product not found.');
  const rows = await repo.listImagesByProduct(db, productId);
  return rows.map(toAdminImage);
}

export async function createImage(db, actor, productId, input) {
  return runInTransaction(db, async (tx) => {
    const product = await repo.findAdminProductById(tx, productId);
    if (!product) throw notFound('Product not found.');

    const existing = await repo.listImagesByProduct(tx, productId);

    // The first image is always primary, and promoting a new image demotes the
    // current one first so the partial unique index is never violated.
    const makePrimary = input.isPrimary === true || existing.length === 0;
    if (makePrimary) await repo.clearPrimaryForProduct(tx, productId);

    const created = await repo.insertImage(tx, {
      productId,
      imageUrl: input.imageUrl,
      altText: input.altText,
      sortOrder: input.sortOrder ?? 0,
      isPrimary: makePrimary,
    });

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.IMAGE_ADDED,
      entityType: AUDIT_ENTITY.IMAGE,
      entityId: created.id,
      summary: `Added an image to "${product.name}".`,
      changes: { after: { imageUrl: input.imageUrl, isPrimary: makePrimary } },
    });

    const rows = await repo.listImagesByProduct(tx, productId);
    return rows.map(toAdminImage);
  });
}

export async function updateImage(db, actor, imageId, input) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findImageById(tx, imageId);
    if (!existing) throw notFound('Image not found.');

    if (input.isPrimary === true) {
      await repo.clearPrimaryForProduct(tx, existing.product_id, { exceptId: imageId });
    }

    await repo.updateImage(tx, imageId, input);

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.IMAGE_UPDATED,
      entityType: AUDIT_ENTITY.IMAGE,
      entityId: imageId,
      summary: 'Updated a product image.',
      changes: { fields: Object.keys(input) },
    });

    const rows = await repo.listImagesByProduct(tx, existing.product_id);
    return rows.map(toAdminImage);
  });
}

export async function deleteImage(db, actor, imageId) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findImageById(tx, imageId);
    if (!existing) throw notFound('Image not found.');

    await repo.deleteImage(tx, imageId);

    // A primary image was just removed; promote the next in order so the product
    // keeps a primary image rather than silently losing its hero shot.
    if (existing.is_primary) {
      const remaining = await repo.listImagesByProduct(tx, existing.product_id);
      if (remaining.length > 0) {
        await repo.updateImage(tx, remaining[0].id, { isPrimary: true });
      }
    }

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.IMAGE_REMOVED,
      entityType: AUDIT_ENTITY.IMAGE,
      entityId: imageId,
      summary: 'Removed a product image.',
      changes: { before: { imageUrl: existing.image_url } },
    });

    const rows = await repo.listImagesByProduct(tx, existing.product_id);
    return rows.map(toAdminImage);
  });
}

export default {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  archiveProduct,
  listVariants,
  createVariant,
  updateVariant,
  deactivateVariant,
  listImages,
  createImage,
  updateImage,
  deleteImage,
};
