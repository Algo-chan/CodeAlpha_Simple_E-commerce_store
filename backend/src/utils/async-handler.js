/**
 * Wraps an async route handler so rejected promises reach the error middleware
 * instead of hanging the request.
 *
 * Express 5 forwards rejected promises automatically, but using this wrapper
 * keeps controllers explicit and works on any Express version.
 *
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn
 */
export function asyncHandler(fn) {
  return function wrappedHandler(req, res, next) {
    return Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export default asyncHandler;
