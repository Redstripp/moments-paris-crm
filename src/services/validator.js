'use strict';

const VALID_ROLES    = new Set(['user', 'assistant']);
const MAX_MESSAGES   = 20;
const MAX_MSG_CHARS  = 10_000;

/**
 * Valida o array de messages enviado pelo frontend.
 * Retorna null se válido, ou uma string de erro se inválido.
 *
 * @param {unknown} messages
 * @returns {string|null}
 */
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'O campo messages deve ser um array não-vazio.';
  }

  if (messages.length > MAX_MESSAGES) {
    return `Muitas mensagens no histórico (máx. ${MAX_MESSAGES}).`;
  }

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];

    if (typeof m !== 'object' || m === null) {
      return `messages[${i}]: deve ser um objeto.`;
    }

    if (!VALID_ROLES.has(m.role)) {
      return `messages[${i}].role inválido. Use "user" ou "assistant".`;
    }

    if (typeof m.content !== 'string') {
      return `messages[${i}].content deve ser uma string.`;
    }

    if (m.content.length === 0) {
      return `messages[${i}].content não pode ser vazio.`;
    }

    if (m.content.length > MAX_MSG_CHARS) {
      return `messages[${i}].content excede ${MAX_MSG_CHARS} caracteres.`;
    }
  }

  // A última mensagem deve ser do usuário (convenção da Anthropic)
  if (messages[messages.length - 1].role !== 'user') {
    return 'A última mensagem deve ter role "user".';
  }

  return null; // válido
}

module.exports = { validateMessages };
