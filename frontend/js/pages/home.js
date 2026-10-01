/**
 * Home page module (setup-phase only).
 *
 * Its single purpose is to prove that the frontend can talk to the backend:
 * it calls GET /api/v1/health and renders API / database / environment status.
 */
import { api } from '../core/api.js';
import { config } from '../config.js';
import { el, clear, qs } from '../core/dom.js';

const STATUS_VARIANT = {
  healthy: 'badge--success',
  degraded: 'badge--warning',
  offline: 'badge--error',
};

function statusRow(label, value, variant) {
  const badge = el('span.badge', { text: value });
  if (variant) badge.classList.add(variant);

  return el('div.status-list__row', {}, [
    el('span.status-list__label', { text: label }),
    value instanceof Node ? value : badge,
  ]);
}

function renderStatus(container, { api: apiState, database, environment, detail }) {
  clear(container);

  container.append(
    statusRow('API server', apiState, STATUS_VARIANT[apiState]),
    statusRow('Database', database, database === 'connected' ? 'badge--success' : 'badge--error'),
    statusRow('Environment', environment ?? 'unknown', 'badge--info')
  );

  if (detail) {
    container.append(el('p.mt-4.text-sm.text-muted', { text: detail }));
  }
}

export default async function initHome() {
  const container = qs('[data-health-status]');
  if (!container) return;

  renderStatus(container, {
    api: 'checking',
    database: 'checking',
    environment: '…',
    detail: `Contacting ${config.apiBaseUrl} …`,
  });

  try {
    const health = await api.get('/health');

    renderStatus(container, {
      api: 'healthy',
      database: health.database,
      environment: health.environment,
      detail: `Response time ${health.uptime}s uptime · checked ${health.timestamp}`,
    });

    // Expose the last successful payload for debugging in the console.
    globalThis.__lastHealth = health;
  } catch (error) {
    renderStatus(container, {
      api: 'offline',
      database: 'disconnected',
      environment: 'unknown',
      detail: error.message,
    });
  }
}
