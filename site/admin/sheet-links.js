(() => {
  'use strict';
  const links = Object.freeze({
    music_core: 'https://docs.google.com/spreadsheets/d/191598ZPdnCdDlvoa8aFGGNPmT1_xqEZXOq7vvEEahp0/edit',
    fans_pick: 'https://docs.google.com/spreadsheets/d/1GsFyGTLeJV62T9xsfFyvsxOljRy3Egr7MkahpttlrPs/edit'
  });
  const link = document.getElementById('sheetLink');
  if (!link) return;
  function sync(program) {
    const p = program || document.querySelector('[data-program][aria-pressed="true"]')?.dataset.program || 'music_core';
    link.href = links[p] || links.music_core;
    link.textContent = p === 'fans_pick' ? 'FANS PICK 개인정보 시트 열기 ↗' : '음중 개인정보 시트 열기 ↗';
  }
  document.querySelectorAll('[data-program]').forEach(button => {
    button.addEventListener('click', () => queueMicrotask(() => sync(button.dataset.program)));
  });
  sync();
  document.documentElement.dataset.sheetLinks = 'program-specific';
})();
