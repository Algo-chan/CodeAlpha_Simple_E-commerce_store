/**
 * Dashboard service.
 *
 * Every tile is a count or a sum computed from a real table. Nothing here is an
 * estimate and nothing is inferred: if the number is not in the database it is
 * not on the dashboard. The three money figures in particular are documented in
 * `admin.repository.getOrderMetrics` and are deliberately distinct — gross
 * sales, money collected, and money still owed are not the same thing and a
 * dashboard that shows one without saying which is misleading.
 */
import * as repo from '../../repositories/admin.repository.js';
import { toAdminDashboard } from '../admin.view.js';

const RECENT_ORDER_COUNT = 5;

/**
 * @param {object} db
 * @returns {Promise<object>}
 */
export async function getDashboard(db) {
  const [orders, products, customers, lowStockCount, pendingReviews, recentOrders] =
    await Promise.all([
      repo.getOrderMetrics(db),
      repo.getProductMetrics(db),
      repo.getCustomerMetrics(db),
      repo.getLowStockCount(db),
      repo.getPendingReviewCount(db),
      repo.listRecentOrders(db, RECENT_ORDER_COUNT),
    ]);

  return toAdminDashboard({
    orders,
    products,
    customers,
    lowStockCount,
    pendingReviews,
    recentOrders,
  });
}

export default { getDashboard };
