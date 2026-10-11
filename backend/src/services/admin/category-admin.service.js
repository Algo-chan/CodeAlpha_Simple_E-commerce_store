/**
 * Category administration.
 *
 * The tree is the part that needs care. A category may be re-parented, but it
 * may never become a descendant of itself: a cycle would make the storefront's
 * recursive tree walk non-terminating. Migration 019 installs a trigger that
 * refuses such a write at the database, but relying on that would turn a plain
 * operator mistake into a translated constraint error, so the same rule is
 * checked here first and reported as a clear 422.
 *
 * Archiving sets `is_active = FALSE`. It is not deletion: a category with
 * products or child categories cannot be removed without stranding them, so
 * "archive" hides it from the storefront while keeping the tree intact.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../config/constants.js';
import * as repo from '../../repositories/admin.repository.js';
import { toAdminCategory, toAdminCategoryTree } from '../admin.view.js';
import { recordAudit } from './audit.js';
import { conflict, notFound, resolveSlug, unprocessable } from './common.js';

export async function listCategories(db) {
  const rows = await repo.listAdminCategories(db);
  return {
    categories: rows.map(toAdminCategory),
    tree: toAdminCategoryTree(rows),
  };
}

export async function getCategory(db, id) {
  const row = await repo.findAdminCategoryById(db, id);
  if (!row) throw notFound('Category not found.');
  return toAdminCategory(row);
}

async function assertParentUsable(db, parentId, { selfId = null } = {}) {
  if (parentId === null || parentId === undefined) return;
  if (selfId && parentId === selfId) {
    throw unprocessable('A category cannot be its own parent.');
  }
  const parent = await repo.findAdminCategoryById(db, parentId);
  if (!parent) throw unprocessable('The parent category does not exist.');
  if (selfId && (await repo.isDescendantOf(db, selfId, parentId))) {
    throw unprocessable('A category cannot be moved beneath one of its own descendants.');
  }
}

export async function createCategory(db, actor, input) {
  const slug = resolveSlug(input, input.name);

  return runInTransaction(db, async (tx) => {
    if (await repo.findAdminCategoryBySlug(tx, slug, {})) {
      throw conflict('A category with this slug already exists.');
    }
    await assertParentUsable(tx, input.parentId);

    const created = await repo.insertCategory(tx, {
      name: input.name,
      slug,
      parentId: input.parentId ?? null,
      description: input.description,
      imageUrl: input.imageUrl,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    });

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.CATEGORY_CREATED,
      entityType: AUDIT_ENTITY.CATEGORY,
      entityId: created.id,
      summary: `Created category "${input.name}" (${slug}).`,
      changes: { after: { name: input.name, slug, parentId: input.parentId ?? null } },
    });

    return toAdminCategory(await repo.findAdminCategoryById(tx, created.id));
  });
}

export async function updateCategory(db, actor, id, input) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findAdminCategoryById(tx, id);
    if (!existing) throw notFound('Category not found.');

    if (input.slug && input.slug !== existing.slug) {
      if (await repo.findAdminCategoryBySlug(tx, input.slug, { excludeId: id })) {
        throw conflict('A category with this slug already exists.');
      }
    }
    if (input.parentId !== undefined) {
      await assertParentUsable(tx, input.parentId, { selfId: id });
    }

    await repo.updateCategory(tx, id, input);

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.CATEGORY_UPDATED,
      entityType: AUDIT_ENTITY.CATEGORY,
      entityId: id,
      summary: `Updated category "${existing.name}".`,
      changes: { fields: Object.keys(input) },
    });

    return toAdminCategory(await repo.findAdminCategoryById(tx, id));
  });
}

export async function archiveCategory(db, actor, id) {
  return runInTransaction(db, async (tx) => {
    const existing = await repo.findAdminCategoryById(tx, id);
    if (!existing) throw notFound('Category not found.');

    if (existing.is_active) {
      await repo.updateCategory(tx, id, { isActive: false });
      await recordAudit(tx, actor, {
        action: AUDIT_ACTION.CATEGORY_ARCHIVED,
        entityType: AUDIT_ENTITY.CATEGORY,
        entityId: id,
        summary: `Deactivated category "${existing.name}".`,
        changes: { before: { isActive: true }, after: { isActive: false } },
      });
    }

    return toAdminCategory(await repo.findAdminCategoryById(tx, id));
  });
}

export default { listCategories, getCategory, createCategory, updateCategory, archiveCategory };
