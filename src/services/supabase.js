'use strict';

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

/**
 * Cliente Supabase com service_role key.
 * Usado exclusivamente para:
 *   1. Verificar JWTs de sessão (auth.getUser)
 *   2. Persistir e consultar o budget diário de tokens (rpc)
 *
 * NUNCA expor SUPABASE_KEY ao frontend.
 */
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = { supabaseAdmin };
