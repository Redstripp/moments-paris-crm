const express   = require('express');
const cors      = require('cors');
const rateLimit = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY || 'sk-ant-SUA-CHAVE-AQUI';
const PROXY_SECRET   = process.env.PROXY_SECRET || '';   // token secreto
const MODEL          = 'claude-haiku-4-5-20251001';
const MAX_TOKENS     = 1024;

app.use(cors({
  origin: 'https://Redstripp.github.io',
  methods: ['POST', 'GET'],
}));
app.use(express.json({ limit: '500kb' }));  // reduzido de 2mb para 500kb

// ── Rate limiting: 10 requests por minuto por IP ──────────────
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Muitas requisições. Tente em 1 minuto.' }
});
app.use('/api/ai', limiter);

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Moment's Paris AI Proxy" });
});

// ── Middleware de autenticação por token ──────────────────────
function requireToken(req, res, next) {
  if (!PROXY_SECRET) return next(); // sem secret configurado, passa
  const token = req.headers['x-proxy-token'];
  if (!token || token !== PROXY_SECRET) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  next();
}

// ── Endpoint principal ────────────────────────────────────────
app.post('/api/ai', requireToken, async (req, res) => {
  const { system, messages } = req.body;

  if (!system || !messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Campos system e messages são obrigatórios.' });
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: MAX_TOKENS, system, messages }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data?.error || 'Erro da API Anthropic.' });
    }

    const reply = data?.content?.[0]?.text || '';
    res.json({ reply });

  } catch (err) {
    console.error('Erro ao chamar Anthropic:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

app.listen(PORT, () => console.log(`✅ Servidor rodando na porta ${PORT}`));
