const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY  || '';
const SUPABASE_URL   = process.env.SUPABASE_URL        || '';
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY || ''; // service_role key (server-side only)
const MODEL          = 'claude-haiku-4-5-20251001';
const MAX_TOKENS     = 1024;

// ── Validação de variáveis obrigatórias na inicialização ──────────────────────
if (!ANTHROPIC_KEY) {
  console.error('❌ FATAL: ANTHROPIC_API_KEY não definida.');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ FATAL: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórias para validar JWTs.');
  process.exit(1);
}

// Cliente Supabase (service_role) — usado APENAS para verificar sessões
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── CORS: apenas a origem do frontend ────────────────────────────────────────
app.use(
  cors({
    origin: 'https://redstripp.github.io',
    methods: ['POST', 'GET'],
  }),
);
app.use(express.json({ limit: '500kb' }));

// ── Autenticação via JWT Supabase ─────────────────────────────────────────────
// Valida o Bearer token do frontend (access_token da sessão Supabase).
// Retorna o user_id (sub) se válido, ou envia 401.
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Token de autenticação ausente.' });
  }

  try {
    // Verifica o JWT com a service_role key — não faz chamada de rede extra
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }
    // Injeta o user_id no request para uso no rate limiter e logs
    req.userId = data.user.id;
    next();
  } catch (err) {
    console.error('[AUTH] Erro ao verificar JWT:', err.message);
    return res.status(401).json({ error: 'Falha ao validar autenticação.' });
  }
}

// ── Rate limiting por usuário autenticado ─────────────────────────────────────
// requireAuth roda ANTES: req.userId está garantido aqui.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.userId, // granularidade real por usuário
  message: { error: 'Muitas requisições. Tente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Budget diário de tokens ───────────────────────────────────────────────────
const DAILY_TOKEN_BUDGET = parseInt(process.env.DAILY_TOKEN_BUDGET || '50000');
let _dailyTokensUsed = 0;
let _budgetDay = new Date().toISOString().slice(0, 10);

function _trackTokens(outputTokens) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _budgetDay) {
    _dailyTokensUsed = 0;
    _budgetDay = today;
  }
  _dailyTokensUsed += outputTokens;
  const pct = Math.round((_dailyTokensUsed / DAILY_TOKEN_BUDGET) * 100);
  if (pct >= 100) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), event: 'budget_exceeded', used: _dailyTokensUsed, budget: DAILY_TOKEN_BUDGET }));
  } else if (pct >= 80) {
    console.warn(JSON.stringify({ ts: new Date().toISOString(), event: 'budget_warning', used: _dailyTokensUsed, budget: DAILY_TOKEN_BUDGET, pct }));
  }
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Moment's Paris AI Proxy" });
});

// ── Endpoint principal ────────────────────────────────────────────────────────
// Ordem dos middlewares: requireAuth → limiter → handler
app.post('/api/ai', requireAuth, limiter, async (req, res) => {
  const { system, messages } = req.body;

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    event: 'ai_request',
    userId: req.userId,
    systemChars: typeof system === 'string' ? system.length : null,
    msgCount: Array.isArray(messages) ? messages.length : null,
    dailyTokensUsed: _dailyTokensUsed,
    budgetPct: Math.round((_dailyTokensUsed / DAILY_TOKEN_BUDGET) * 100),
  }));

  if (!system || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Campos system e messages são obrigatórios.' });
  }
  if (system.length > 50_000) {
    return res.status(400).json({ error: 'System prompt muito longo (máx. 50.000 caracteres).' });
  }
  if (messages.length > 20) {
    return res.status(400).json({ error: 'Muitas mensagens no histórico (máx. 20).' });
  }
  const msgMuitoLonga = messages.find((m) => (m?.content?.length ?? 0) > 10_000);
  if (msgMuitoLonga) {
    return res.status(400).json({ error: 'Uma ou mais mensagens excedem 10.000 caracteres.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error || 'Erro da API Anthropic.' });
    }

    const reply = data?.content?.[0]?.text || '';
    _trackTokens(data?.usage?.output_tokens || 0);
    res.json({ reply });
  } catch (err) {
    console.error('Erro ao chamar Anthropic:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
