'use strict';

const { Router } = require('express');
const { requireAuth }           = require('../middleware/auth');
const { limiter }               = require('../middleware/rateLimiter');
const { callAnthropic, AnthropicError } = require('../services/anthropic');
const { buildSystemPrompt }     = require('../services/promptBuilder');
const { trackAndCheckBudget, getBudgetStatus, DAILY_TOKEN_BUDGET } = require('../services/budget');
const { validateMessages }      = require('../services/validator');
const { log }                   = require('../services/logger');

const router = Router();

// ── POST /api/ai ──────────────────────────────────────────────────────────────
// Ordem dos middlewares: requireAuth → limiter → handler
router.post('/', requireAuth, limiter, async (req, res) => {
  // O frontend envia: { messages, context }
  // NÃO aceita mais "system" — o system prompt é construído no servidor.
  const { messages, context = {} } = req.body;

  // ── Validação de input ──────────────────────────────────────────────────────
  const validationError = validateMessages(messages);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  // ── Construção do system prompt no servidor ─────────────────────────────────
  const systemPrompt = buildSystemPrompt(req.userId, context);

  log(req, 'info', 'ai_request_start', {
    msgCount: messages.length,
    intent:   context.intent ?? null,
  });

// ── Pré-verificação de budget ────────────────────────────────────────────────
  try {
    const preCheck = await getBudgetStatus();
    if (preCheck.tokensUsed >= DAILY_TOKEN_BUDGET) {
      log(req, 'warn', 'budget_pre_block', { tokensUsed: preCheck.tokensUsed });
      return res.status(429).json({ error: 'Limite diário de uso da IA atingido. Tente novamente amanhã.' });
    }
  } catch (budgetPreErr) {
    log(req, 'warn', 'budget_pre_check_failed', { message: budgetPreErr.message });
    // Se não conseguir verificar, bloqueia por segurança
    return res.status(503).json({ error: 'Serviço temporariamente indisponível.' });
  }
  
  // ── Chamada à Anthropic (com timeout e retry internos) ──────────────────────
  let result;
  try {
    result = await callAnthropic(systemPrompt, messages);
  } catch (err) {
    if (err instanceof AnthropicError) {
      log(req, 'error', 'anthropic_error', {
        status:    err.statusCode,
        message:   err.message,
        retryable: err.retryable,
      });
      return res.status(err.statusCode).json({ error: err.message });
    }
    log(req, 'error', 'unexpected_error', { message: err.message });
    return res.status(500).json({ error: 'Erro interno do servidor.' });
  }

  // ── Budget diário (persistido no Supabase, atômico) ─────────────────────────
  try {
    const budget = await trackAndCheckBudget(result.usage?.output_tokens || 0);

    log(req, 'info', 'ai_request_done', {
      outputTokens: result.usage?.output_tokens,
      inputTokens:  result.usage?.input_tokens,
      tokensUsed:   budget.tokensUsed,
      budgetPct:    Math.round((budget.tokensUsed / DAILY_TOKEN_BUDGET) * 100),
    });

    if (budget.exceeded) {
      log(req, 'warn', 'budget_exceeded', {
        tokensUsed: budget.tokensUsed,
        budget:     DAILY_TOKEN_BUDGET,
      });
    }
  } catch (budgetErr) {
    // Budget é best-effort: falha silenciosa não derruba a resposta
    log(req, 'warn', 'budget_track_failed', { message: budgetErr.message });
  }

  return res.json({ reply: result.reply });
});

module.exports = router;
