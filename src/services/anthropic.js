'use strict';

const ANTHROPIC_URL  = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY  || '';
const MODEL          = process.env.ANTHROPIC_MODEL    || 'claude-haiku-4-5-20251001';
const MAX_TOKENS     = parseInt(process.env.MAX_TOKENS || '1024', 10);
const TIMEOUT_MS     = parseInt(process.env.ANTHROPIC_TIMEOUT_MS || '30000', 10);
const MAX_RETRIES    = parseInt(process.env.ANTHROPIC_MAX_RETRIES || '2', 10);

// Status HTTP que justificam retry (erros transitórios)
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Aguarda um tempo com jitter para evitar thundering herd.
 * @param {number} attempt — índice da tentativa (0-based)
 */
function sleep(attempt) {
  const base  = Math.pow(2, attempt) * 500; // 500ms, 1s, 2s...
  const jitter = Math.random() * 200;       // até +200ms aleatório
  return new Promise((resolve) => setTimeout(resolve, base + jitter));
}

/**
 * Chama a API da Anthropic com timeout configurável e retry automático
 * em falhas transitórias (429, 5xx, erros de rede).
 *
 * @param {string} systemPrompt — system prompt construído no servidor
 * @param {Array}  messages     — histórico de mensagens validado
 * @returns {{ reply: string, usage: object }}
 * @throws {AnthropicError}
 */
async function callAnthropic(systemPrompt, messages) {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(ANTHROPIC_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type':    'application/json',
          'x-api-key':       ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      MODEL,
          max_tokens: MAX_TOKENS,
          system:     systemPrompt,
          messages,
        }),
      });

      clearTimeout(timer);

      // Erros transitórios: tenta novamente se ainda há tentativas
      if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_RETRIES) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : null;
        await (waitMs ? new Promise((r) => setTimeout(r, waitMs)) : sleep(attempt));
        continue;
      }

      const data = await response.json();

      if (!response.ok) {
        const msg = data?.error?.message || data?.error || 'Erro da API Anthropic.';
        throw new AnthropicError(msg, response.status, false /* não retentável aqui */);
      }

      return {
        reply: data?.content?.[0]?.text || '',
        usage: data?.usage || {},
      };
    } catch (err) {
      clearTimeout(timer);

      // Timeout: AbortError
      if (err.name === 'AbortError') {
        lastError = new AnthropicError(
          `Timeout após ${TIMEOUT_MS}ms chamando a Anthropic.`,
          504,
          attempt < MAX_RETRIES,
        );
        if (attempt < MAX_RETRIES) {
          await sleep(attempt);
          continue;
        }
        throw lastError;
      }

      // Erros de rede (ECONNREFUSED, etc.)
      if (err instanceof AnthropicError) throw err;

      lastError = err;
      if (attempt < MAX_RETRIES) {
        await sleep(attempt);
        continue;
      }

      throw new AnthropicError(`Erro de rede: ${err.message}`, 502, false);
    }
  }

  throw lastError;
}

class AnthropicError extends Error {
  /**
   * @param {string}  message
   * @param {number}  statusCode — HTTP status a retornar ao cliente
   * @param {boolean} retryable  — indica se foi resolvido com retry
   */
  constructor(message, statusCode = 500, retryable = false) {
    super(message);
    this.name       = 'AnthropicError';
    this.statusCode = statusCode;
    this.retryable  = retryable;
  }
}

module.exports = { callAnthropic, AnthropicError, MODEL };
