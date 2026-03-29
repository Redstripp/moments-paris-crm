'use strict';

const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const { getBudgetStatus } = require('./services/budget');
const { log }             = require('./services/logger');

// ── Validação de variáveis obrigatórias na inicialização ──────────────────────
const REQUIRED_ENV = [
  'ANTHROPIC_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'DATABASE_URL',       // Postgres connection string para rate limit store
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`❌ FATAL: variáveis de ambiente obrigatórias não definidas: ${missing.join(', ')}`);
  process.exit(1);
}

// ── App ───────────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware global: Request ID ─────────────────────────────────────────────
// Injeta um ID único em cada requisição para correlação de logs.
app.use((req, _res, next) => {
  req.requestId = crypto.randomUUID();
  next();
});

// ── CORS: apenas a origem do frontend ────────────────────────────────────────
app.use(
  cors({
    origin:  process.env.ALLOWED_ORIGIN || 'https://redstripp.github.io',
    methods: ['POST', 'GET'],
  }),
);

app.use(express.json({ limit: '500kb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', async (_req, res) => {
  try {
    const budget = await getBudgetStatus();
    return res.json({
      status:    'ok',
      service:   "Moment's Paris AI Proxy",
      budgetPct: budget.budgetPct,
    });
  } catch {
    return res.json({ status: 'ok', service: "Moment's Paris AI Proxy" });
  }
});

// ── Rotas ─────────────────────────────────────────────────────────────────────
app.use('/api/ai', require('./routes/ai'));

// ── Handler de rotas não encontradas ─────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

// ── Handler global de erros ───────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  log(req, 'error', 'unhandled_error', { message: err.message, stack: err.stack });
  res.status(500).json({ error: 'Erro interno do servidor.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(JSON.stringify({
    ts:      new Date().toISOString(),
    event:   'server_start',
    port:    PORT,
    model:   process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001',
    budget:  process.env.DAILY_TOKEN_BUDGET || '50000',
    origin:  process.env.ALLOWED_ORIGIN || 'https://redstripp.github.io',
  }));
});
