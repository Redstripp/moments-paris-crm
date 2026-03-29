'use strict';

/**
 * Logger estruturado.
 * Todos os logs emitem JSON com requestId, userId, timestamp e event —
 * facilitando correlação em qualquer agregador (Datadog, Logtail, etc.).
 */

const LEVELS = { info: 'info', warn: 'warn', error: 'error' };

/**
 * @param {import('express').Request} req
 * @param {'info'|'warn'|'error'} level
 * @param {string} event
 * @param {object} [extra]
 */
function log(req, level, event, extra = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level: LEVELS[level] ?? 'info',
    requestId: req?.requestId ?? null,
    userId: req?.userId ?? null,
    event,
    ...extra,
  };

  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

module.exports = { log };
