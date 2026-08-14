(() => {
  'use strict';

  function styleRequiredLabel() {
    const label = document.getElementById('consentLabel');
    if (!label) return;

    const text = label.textContent.trim();
    const match = text.match(/^(\[[^\]]+\]|【[^】]+】)\s*/);
    if (!match) return;

    label.textContent = '';
    const required = document.createElement('strong');
    required.textContent = match[1];
    label.append(required, document.createTextNode(` ${text.slice(match[0].length)}`));
  }

  document.addEventListener('DOMContentLoaded', styleRequiredLabel);
  window.addEventListener('mc-language-change', styleRequiredLabel);
})();
