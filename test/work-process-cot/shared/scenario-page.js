(function () {
  function paint() {
    const id = document.body.dataset.scenario;
    const data = CotScenarios.models()[id];
    if (!data) return;

    const note = document.querySelector('[data-note]');
    if (note) note.innerHTML = data.note;

    const user = document.querySelector('[data-user]');
    if (user) user.textContent = data.user;

    const wpMount = document.querySelector('#wp-mount');
    const finalMount = document.querySelector('#final-mount');
    const altMount = document.querySelector('#alt-wp-mount');
    const altNote = document.querySelector('[data-alt-note]');

    if (wpMount) {
      if (data.wp) {
        CotRender.mount(wpMount, data.wp);
      } else {
        wpMount.innerHTML = '';
      }
    }

    if (finalMount) {
      if (data.final) {
        finalMount.classList.remove('hidden');
        finalMount.innerHTML = `<div class="conversation-bubble conversation-bubble-assistant"><div class="markdown-body">${data.final}</div></div>`;
      } else {
        finalMount.classList.add('hidden');
        finalMount.innerHTML = '';
      }
    }

    if (altNote && data.altNote) {
      altNote.classList.remove('hidden');
      altNote.innerHTML = data.altNote;
    }

    if (altMount && data.altWp) {
      altMount.classList.remove('hidden');
      CotRender.mount(altMount, data.altWp);
    }
  }

  function boot() {
    CotShell.ensureTheme();
    CotI18n.setLocale(CotI18n.getLocale());
    CotShell.mountShell({
      active: document.body.dataset.scenario,
      onLocaleChange: paint,
    });
    paint();
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
