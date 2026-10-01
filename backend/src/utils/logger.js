/**
 * Minimal levelled logger.
 *
 * A real deployment can swap this for pino or winston without touching any
 * other file, because every module only imports `logger` from this file.
 */
import env from '../config/env.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

function format(level, args) {
  const timestamp = new Date().toISOString();
  return [`[${timestamp}] [${level.toUpperCase()}]`, ...args];
}

function emit(level, consoleMethod, args) {
  if (LEVELS[level] < threshold) return;
  consoleMethod(...format(level, args));
}

export const logger = {
  debug: (...args) => emit('debug', console.debug, args),
  info: (...args) => emit('info', console.info, args),
  warn: (...args) => emit('warn', console.warn, args),
  error: (...args) => emit('error', console.error, args),
};

export default logger;
