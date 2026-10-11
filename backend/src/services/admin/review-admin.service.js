/**
 * Review moderation.
 *
 * APPROVED or REJECTED, never anything else. A review is submitted PENDING; an
 * operator either publishes it or hides it. The transition may go from PENDING
 * to a decision, or a decision may be reversed (an APPROVED review rejected
 * later), which is why both target states are accepted from any current state —
 * with the one exception that a no-op is refused so the audit trail never
 * records a change that did not happen.
 *
 * AUTHOR CONTENT IS NEVER TOUCHED. `moderateReview` updates only status, the
 * moderator, the timestamp and an optional note. The words a customer wrote
 * stay exactly as written, so a rejected review remains auditable rather than
 * being quietly edited.
 */
import { runInTransaction } from '../../utils/transaction.js';
import { AUDIT_ACTION, AUDIT_ENTITY } from '../../config/constants.js';
import * as repo from '../../repositories/admin.repository.js';
import { toAdminReview } from '../admin.view.js';
import { recordAudit } from './audit.js';
import { notFound, paginationMeta, resolvePaging, unprocessable } from './common.js';

export async function listReviews(db, query) {
  const { page, limit, offset } = resolvePaging(query);
  const filters = { search: query.search, status: query.status };

  const { rows, total } = await repo.listAdminReviews(db, filters, {
    limit,
    offset,
    sort: query.sort,
  });

  return {
    reviews: rows.map(toAdminReview),
    pagination: paginationMeta({ page, limit, total, returned: rows.length }),
  };
}

export async function getReview(db, id) {
  const review = await repo.findAdminReviewById(db, id);
  if (!review) throw notFound('Review not found.');
  return toAdminReview(review);
}

export async function moderate(db, actor, id, input) {
  return runInTransaction(db, async (tx) => {
    const review = await repo.findAdminReviewById(tx, id);
    if (!review) throw notFound('Review not found.');

    if (review.status === input.status) {
      throw unprocessable(`Review is already ${input.status}.`);
    }

    await repo.moderateReview(tx, id, {
      status: input.status,
      moderatedBy: actor?.id ?? null,
      note: input.note ?? null,
    });

    await recordAudit(tx, actor, {
      action: AUDIT_ACTION.REVIEW_MODERATED,
      entityType: AUDIT_ENTITY.REVIEW,
      entityId: id,
      summary: `Review on "${review.product_name}" set to ${input.status}.`,
      changes: {
        before: { status: review.status },
        after: { status: input.status },
        ...(input.note ? { note: input.note } : {}),
      },
    });

    return toAdminReview(await repo.findAdminReviewById(tx, id));
  });
}

export default { listReviews, getReview, moderate };
