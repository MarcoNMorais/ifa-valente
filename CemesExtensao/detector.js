(function (global) {
  const SUCCESS_TEXT = 'solicitação agendada com sucesso';

  function normalizeText(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function isSuccessText(value) {
    return normalizeText(value).includes(normalizeText(SUCCESS_TEXT));
  }

  function looksLikeSuccessElement(element) {
    if (!element || !isSuccessText(element.textContent)) return false;
    const className = String(element.className || '').toLowerCase();
    const role = element.getAttribute?.('role');
    const style = global.getComputedStyle ? global.getComputedStyle(element) : null;
    const colorHint = `${className} ${style?.backgroundColor || ''}`;
    return role === 'alert' || role === 'status' || /success|sucesso|green|verde|alert/.test(colorHint) || isSuccessText(element.textContent);
  }

  function findSuccessElements(root = global.document) {
    if (!root?.querySelectorAll) return [];
    const candidates = [...root.querySelectorAll('[role="alert"], [role="status"], .alert, .toast, .notification, .snackbar, div')];
    return candidates.filter(looksLikeSuccessElement).filter((element, index, all) => !all.some((other, otherIndex) => otherIndex !== index && element.contains(other) && isSuccessText(other.textContent)));
  }

  global.CMVRDetector = { normalizeText, isSuccessText, looksLikeSuccessElement, findSuccessElements };
})(typeof window !== 'undefined' ? window : globalThis);
