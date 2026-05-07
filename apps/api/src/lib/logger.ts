/**
 * Minimal structured logger. Prints JSON in production, pretty in dev.
 */
import { config } from './config.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
  const time = new Date().toISOString();
  if (config.isProduction) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ time, level, msg, ...meta }));
  } else {
    const prefix = level.toUpperCase().padEnd(5);
    // eslint-disable-next-line no-console
    console.log(`[${time}] ${prefix} ${msg}`, meta ?? '');
  }
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
