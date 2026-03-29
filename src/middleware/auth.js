'use strict';

const { supabaseAdmin } = require('../services/supabase');
const { log } = require('../services/logger');

/**
 * Middleware de autenticação via JWT Supabase.
 *
 * - Extrai o Bearer token do header Authorization
 * - Valida com supabaseAdmin.auth.getUser (verificação local do JWT)
 * - Injeta req.userId para uso nos middlewares seguintes
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      log(req, 'warn', 'auth_failed', { reason: error?.message || 'user_not_found' });
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    req.userId = data.user.id;
    next();
  } catch (err) {
    log(req, 'error', 'auth_exception', { message: err.message });
    return res.status(401).json({ error: 'Falha ao validar autenticação.' });
  }
}

module.exports = { requireAuth };
