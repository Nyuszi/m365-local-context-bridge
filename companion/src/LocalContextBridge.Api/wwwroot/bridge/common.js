window.BridgeUI = (function () {
  const API = '';

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme || 'system';
  }

  async function loadTheme() {
    try {
      const r = await fetch(`${API}/api/v1/local/ui-preferences`);
      const j = await r.json();
      applyTheme(j.theme || 'system');
      return j.theme || 'system';
    } catch {
      applyTheme('system');
      return 'system';
    }
  }

  async function setTheme(theme) {
    applyTheme(theme);
    await fetch(`${API}/api/v1/local/ui-preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme }),
    });
  }

  function wireThemeSwitch(root) {
    root = root || document;
    const buttons = root.querySelectorAll('[data-theme-set]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', async () => {
        const theme = btn.getAttribute('data-theme-set');
        await setTheme(theme);
        buttons.forEach((b) => b.classList.toggle('active', b === btn));
      });
    });
    loadTheme().then((theme) => {
      buttons.forEach((b) =>
        b.classList.toggle('active', b.getAttribute('data-theme-set') === theme),
      );
    });
  }

  function aliasFromPath(path) {
    const trimmed = String(path || '').replace(/[/\\]+$/, '');
    const parts = trimmed.split(/[/\\]/).filter(Boolean);
    const last = parts[parts.length - 1] || 'project';
    return (
      last
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'project'
    );
  }

  async function fetchJson(path, init) {
    const r = await fetch(`${API}${path}`, init);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(j.error?.message || `Request failed (${r.status})`);
      err.payload = j;
      throw err;
    }
    return j;
  }

  return { applyTheme, loadTheme, setTheme, wireThemeSwitch, aliasFromPath, fetchJson };
})();
