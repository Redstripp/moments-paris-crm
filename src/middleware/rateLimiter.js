'use strict';

const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

class PostgresRateLimitStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
  }

  async increment(key) {
    const expire = new Date(Date.now() + this.windowMs);
    const result = await pgPool.query(
      `INSERT INTO rate_limits (key, points, expire)
         VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE
         SET points = CASE
               WHEN rate_limits.expire < NOW() THEN 1
               ELSE rate_limits.points + 1
             END,
             expire = CASE
               WHEN rate_limits.expire < NOW() THEN $2
               ELSE rate_limits.expire
             END
       RETURNING points, expire`,
      [key, expire],
    );
    const row = result.rows[0];
    return { totalHits: row.points, resetTime: new Date(row.expire) };
  }

  async decrement(key) {
    await pgPool.query(
      `UPDATE rate_limits SET points = GREATEST(points - 1, 0) WHERE key = $1`,
      [key],
    );
  }

  async resetKey(key) {
    await pgPool.query(`DELETE FROM rate_limits WHERE key = $1`, [key]);
  }
}

const WINDOW_MS = 60 * 1_000;

const limiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  keyGenerator: (req) => `ai_rate:${req.userId}`,
  store: new PostgresRateLimitStore(WINDOW_MS),
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: async () => {
    try {
      await pgPool.query('SELECT 1');
      return false;
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        event: 'rate_limit_store_unavailable',
        message: err.message,
      }));
      return true;
    }
  },
});

module.exports = { limiter };
