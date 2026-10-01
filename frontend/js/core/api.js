/**
 * Minimal API client.
 *
 * Every network call from the frontend goes through this module so that:
 * - the API base URL is defined in exactly one place
 * - the `{ success, data }` envelope is unwrapped in one place
 * - errors are normalized into a single `ApiError` shape
 */
import { config } from '../config.js';

/** Normalized error thrown for any failed request. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN_ERROR', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function parseBody(response) {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return null;
  return response.json();
}

/**
 * Performs a request and returns the parsed envelope.
 * @param {string} path - path relative to the API base, e.g. `/health`
 * @param {RequestInit & { query?: object }} [options]
 * @returns {Promise<any>} the `data` property of a successful response
 */
export async function request(path, options = {}) {
  const { query, headers, ...rest } = options;

  const url = new URL(`${config.apiBaseUrl}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  let response;
  try {
    response = await fetch(url, {
      ...rest,
      signal: rest.signal ?? controller.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    throw new ApiError(
      error.name === 'AbortError'
        ? `Request to ${url.pathname} timed out.`
        : `Cannot reach the API at ${config.apiBaseUrl}. Is the backend running?`,
      { code: 'NETWORK_ERROR' }
    );
  } finally {
    clearTimeout(timeout);
  }

  const body = await parseBody(response);

  if (!response.ok || body?.success === false) {
    throw new ApiError(body?.error?.message ?? `Request failed with status ${response.status}`, {
      status: response.status,
      code: body?.error?.code ?? 'UNKNOWN_ERROR',
      details: body?.error?.details ?? null,
    });
  }

  return body?.data ?? null;
}

export const api = {
  get: (path, options) => request(path, { ...options, method: 'GET' }),
  post: (path, body, options) =>
    request(path, { ...options, method: 'POST', body: JSON.stringify(body ?? {}) }),
  put: (path, body, options) =>
    request(path, { ...options, method: 'PUT', body: JSON.stringify(body ?? {}) }),
  patch: (path, body, options) =>
    request(path, { ...options, method: 'PATCH', body: JSON.stringify(body ?? {}) }),
  delete: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

export default api;
