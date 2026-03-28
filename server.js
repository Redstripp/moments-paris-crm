const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const PROXY_SECRET = process.env.PROXY_SECRET || '';
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;

// ── Validação de variáveis obrigatórias na inicialização ──────
if (!ANTHROPIC_KEY) {
  console.error('❌ FATAL: variável de ambiente ANTHROPIC_API_KEY não definida. Configure-a antes de iniciar.');
  process.exit(1);
}
if (!PROXY_SECRET) {
  console.error(
    '❌ FATAL: variável de ambiente PROXY_SECRET não definida. O endpoint ficaria aberto sem ela. Configure-a antes de iniciar.',
  );
  process.exit(1);
}

app.use(
  cors({
    origin: 'https://redstripp.github.io',
    methods: ['POST', 'GET'],
  }),
);
app.use(express.json({ limit: '500kb' })); // reduzido de 2mb para 500kb

// ── Rate limiting por token (não por IP — IP é trivialmente bypassável) ──────
// Usa o x-proxy-token como chave: vincula o limite ao usuário autenticado.
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.headers['x-proxy-token'] || req.ip,
  message: { error: 'Muitas requisições. Tente em 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/ai', limiter);

// ── Budget diário de tokens consumidos ───────────────────────
// Conta tokens de saída retornados pela Anthropic e alerta ao atingir o limite.
// Zera à meia-noite UTC. Não bloqueia requests — apenas loga alertas.
const DAILY_TOKEN_BUDGET = parseInt(process.env.DAILY_TOKEN_BUDGET || '50000');
let _dailyTokensUsed = 0;
let _budgetDay = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

function _trackTokens(outputTokens) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== _budgetDay) {
    _dailyTokensUsed = 0;
    _budgetDay = today;
  }
  _dailyTokensUsed += outputTokens;
  const pct = Math.round((_dailyTokensUsed / DAILY_TOKEN_BUDGET) * 100);
  if (pct >= 100) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'budget_exceeded',
        used: _dailyTokensUsed,
        budget: DAILY_TOKEN_BUDGET,
      }),
    );
  } else if (pct >= 80) {
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'budget_warning',
        used: _dailyTokensUsed,
        budget: DAILY_TOKEN_BUDGET,
        pct,
      }),
    );
  }
}

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Moment's Paris AI Proxy" });
});

// ── Middleware de autenticação por token ──────────────────────
function requireToken(req, res, next) {
  // PROXY_SECRET é garantido não-vazio pelo check de inicialização acima
  const token = req.headers['x-proxy-token'];
  if (!token || token !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  next();
}

// ── Endpoint principal ────────────────────────────────────────
app.post('/api/ai', requireToken, async (req, res) => {
  const { system, messages } = req.body;

  // ── Log estruturado de entrada ────────────────────────────────
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: 'ai_request',
      systemChars: typeof system === 'string' ? system.length : null,
      msgCount: Array.isArray(messages) ? messages.length : null,
      dailyTokensUsed: _dailyTokensUsed,
      budgetPct: Math.round((_dailyTokensUsed / DAILY_TOKEN_BUDGET) * 100),
    }),
  );
  if (!system || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Campos system e messages são obrigatórios.' });
  }

  // ── Validação de tamanho ──────────────────────────────────────
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
