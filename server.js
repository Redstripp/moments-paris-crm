const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ✅ Sua chave da Anthropic — coloque aqui ou use variável de ambiente
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-SUA-CHAVE-AQUI';
const MODEL         = 'claude-haiku-4-5-20251001';
const MAX_TOKENS    = 1024;

app.use(cors()); // permite chamadas do GitHub Pages
app.use(express.json({ limit: '2mb' }));

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: "Moment's Paris AI Proxy" });
});

// ── Endpoint principal chamado pelo CRM ──────────────────────
app.post('/api/ai', async (req, res) => {
  const { system, messages } = req.body;

  if (!system || !messages || !Array.isArray(messages)) {
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
