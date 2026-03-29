'use strict';

const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');

// ── Pool dedicado para o rate limiter ────────────────────────────────────────
// Separado do Supabase client para ter controle de conexões e timeout próprios.
const pgPool = new Pool({
  connectionString: process.env.DATABASE_URL, // postgres://... (Supabase connection string)
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

// ── Store customizada usando Postgres ─────────────────────────────────────────
// Implementa a interface mínima esperada pelo express-rate-limit:
// increment(key) → { totalHits, resetTime }
// decrement(key) — opcional, não implementado
// resetKey(key)  — opcional
class PostgresRateLimitStore {
  constructor(windowMs) {
    this.windowMs = windowMs;
  }

  /**
   * Incrementa o contador para a key e retorna o estado atual.
   * Usa INSERT ... ON CONFLICT para garantir atomicidade.
   */
  async increment(key) {
    const expire = new Date(Date.now() + this.windowMs);

    const result = await pgPool.query(
      `
      INSERT INTO rate_limits (key, points, expire)
        VALUES ($1, 1, $2)
      ON CONFLICT (key) DO UPDATE
        SET points = CASE
              WHEN rate_limits.expire < NOW() THEN 1          -- janela expirou: reinicia
              ELSE rate_limits.points + 1
            END,
            expire = CASE
              WHEN rate_limits.expire < NOW() THEN $2          -- reinicia o expire também
              ELSE rate_limits.expire
            END
      RETURNING points, expire
      `,
      [key, expire],
    );

    const row = result.rows[0];
    return {
      totalHits: row.points,
      resetTime: new Date(row.expire),
    };
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

// ── Limiter configurado ───────────────────────────────────────────────────────
const WINDOW_MS = 60 * 1_000; // 1 minuto

const limiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  // requireAuth roda antes: req.userId está garantido
  keyGenerator: (req) => `ai_rate:${req.userId}`,
  store: new PostgresRateLimitStore(WINDOW_MS),
  message: { error: 'Muitas requisições. Tente novamente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Não deixa o limiter quebrar a aplicação se o Postgres estiver indisponível:
  // cai no comportamento padrão (permite a requisição) e loga o erro.
  skip: async (req) => {
    try {
      await pgPool.query('SELECT 1');
      return false;
    } catch (err) {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        event: 'rate_limit_store_unavailable',
        message: err.message,
      }));
      return true; // falha aberta: prefere disponibilidade a bloquear tudo
    }
  },
});

module.exports = { limiter };
