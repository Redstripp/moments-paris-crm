'use strict';

const { supabaseAdmin } = require('./supabase');

const DAILY_TOKEN_BUDGET = parseInt(process.env.DAILY_TOKEN_BUDGET || '50000', 10);

/**
 * Incrementa o uso de tokens do dia e verifica se o budget foi excedido.
 * A operação é atômica via função Postgres (INSERT ... ON CONFLICT DO UPDATE),
 * garantindo consistência mesmo com múltiplos workers simultâneos.
 *
 * @param {number} outputTokens — tokens consumidos na chamada atual
 * @returns {{ tokensUsed: number, exceeded: boolean }}
 * @throws {Error} se a chamada ao Supabase falhar
 */
async function trackAndCheckBudget(outputTokens) {
  const today = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

  const { data, error } = await supabaseAdmin.rpc('increment_daily_tokens', {
    p_date:   today,
    p_tokens: outputTokens,
    p_budget: DAILY_TOKEN_BUDGET,
  });

  if (error) {
    // Loga mas não derruba a resposta já enviada — o budget é best-effort
    // em caso de falha de rede com o Supabase.
    throw new Error(`Budget RPC falhou: ${error.message}`);
  }

  const row = data?.[0];
  return {
    tokensUsed: row?.tokens_used ?? 0,
    exceeded:   row?.exceeded   ?? false,
  };
}

/**
 * Consulta o uso atual sem incrementar. Útil para health check e logs.
 * @returns {{ tokensUsed: number, budgetPct: number }}
 */
async function getBudgetStatus() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabaseAdmin
    .from('ai_token_budget')
    .select('tokens_used')
    .eq('day', today)
    .maybeSingle();

  if (error) throw new Error(`Budget query falhou: ${error.message}`);

  const tokensUsed = data?.tokens_used ?? 0;
  return {
    tokensUsed,
    budgetPct: Math.round((tokensUsed / DAILY_TOKEN_BUDGET) * 100),
  };
}

module.exports = { trackAndCheckBudget, getBudgetStatus, DAILY_TOKEN_BUDGET };
