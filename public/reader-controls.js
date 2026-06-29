(function () {
  const KEY = 'readerPreferences';
  const defaults = { theme: 'sepia', fontSize: 18, width: 'medium' };

  function load() {
    try { return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
    catch { return { ...defaults }; }
  }
  function save(p) { localStorage.setItem(KEY, JSON.stringify(p)); }

  function applyTheme(theme) {
    const body = document.body;
    const root = document.documentElement;
    const themes = {
      light: ['#ffffff', '#1a1a1a', false],
      dark:  ['#1e1e1e', '#d4d4d4', true],
      sepia: ['#fbf4e8', '#5b4637', false],
    };
    const [bg, text, dark] = themes[theme] || themes.sepia;
    root.style.setProperty('--bg-color', bg);
    root.style.setProperty('--text-color', text);
    body.classList.toggle('theme-dark', dark);
    document.querySelectorAll('[data-theme]').forEach(b =>
      b.classList.toggle('active', b.dataset.theme === theme));
  }

  function applyFont(size) {
    document.documentElement.style.setProperty('--font-size-base', size + 'px');
  }

  function applyWidth(width) {
    const widths = { narrow: '50ch', medium: '65ch', wide: '90ch' };
    document.documentElement.style.setProperty('--prose-max-width', widths[width] || '65ch');
    document.querySelectorAll('[data-width]').forEach(b =>
      b.classList.toggle('active', b.dataset.width === width));
  }

  const prefs = load();
  applyTheme(prefs.theme);
  applyFont(prefs.fontSize);
  applyWidth(prefs.width);

  document.querySelectorAll('[data-theme]').forEach(btn =>
    btn.addEventListener('click', function () {
      prefs.theme = this.dataset.theme;
      applyTheme(prefs.theme);
      save(prefs);
    }));

  document.getElementById('font-decrease').addEventListener('click', function () {
    prefs.fontSize = Math.max(12, prefs.fontSize - 2);
    applyFont(prefs.fontSize); save(prefs);
  });
  document.getElementById('font-increase').addEventListener('click', function () {
    prefs.fontSize = Math.min(32, prefs.fontSize + 2);
    applyFont(prefs.fontSize); save(prefs);
  });

  document.querySelectorAll('[data-width]').forEach(btn =>
    btn.addEventListener('click', function () {
      prefs.width = this.dataset.width;
      applyWidth(prefs.width); save(prefs);
    }));
})();
