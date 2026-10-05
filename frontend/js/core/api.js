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
  // A JSON content-type over an empty or truncated body (a 204, a proxy's 502
  // page) must not escape as a SyntaxError: everything leaving this module is
  // either an envelope or an ApiError.
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Performs a request and returns the parsed envelope.
 * @param {string} path - path relative to the API base, e.g. `/health`
 * @param {RequestInit & { query?: object }} [options]
 * @returns {Promise<any>} the `data` property of a successful response
 */
export async function request(path, options = {}) {
  const { query, headers, ...rest } = options;

  // Joined, not concatenated: an injected base ending in "/" plus a path
  // beginning with "/" would otherwise request ".../api/v1//products".
  const base = config.apiBaseUrl.replace(/\/+$/, '');
  const url = new URL(`${base}/${String(path).replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  // A caller's signal has to feed the same controller. Handing it to fetch
  // instead would disconnect the timeout from the request entirely, and would
  // report the caller's own cancellation as a timeout.
  const onCallerAbort = () => controller.abort();
  if (rest.signal?.aborted) controller.abort();
  else rest.signal?.addEventListener('abort', onCallerAbort, { once: true });

  let response;
  try {
    response = await fetch(url, {
      ...rest,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      // Cancelling a request the caller no longer needs (a stale search, a
      // closed panel) is not an outage, and must not be dressed up as one.
      if (rest.signal?.aborted) {
        throw new ApiError(`Request to ${url.pathname} was cancelled.`, { code: 'ABORTED' });
      }
      throw new ApiError(`Request to ${url.pathname} timed out.`, { code: 'REQUEST_TIMEOUT' });
    }
    throw new ApiError(`Cannot reach the API at ${config.apiBaseUrl}. Is the backend running?`, {
      code: 'NETWORK_ERROR',
    });
  } finally {
    clearTimeout(timeout);
    rest.signal?.removeEventListener('abort', onCallerAbort);
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
