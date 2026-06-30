(function () {
  const KEY = 'readerPreferences';
  const defaults = { theme: 'sepia', fontSize: 18, widthPercent: 80 };

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

  function applyWidthPercent(percent) {
    // clamp between 40% and 95%
    const clamped = Math.min(95, Math.max(40, percent));
    document.documentElement.style.setProperty('--prose-max-width', clamped + '%');
    const indicator = document.getElementById('width-indicator');
    if (indicator) indicator.textContent = clamped + '%';
    return clamped;
  }

  const prefs = load();
  applyTheme(prefs.theme);
  applyFont(prefs.fontSize);
  prefs.widthPercent = applyWidthPercent(prefs.widthPercent);

  // Theme buttons
  document.querySelectorAll('[data-theme]').forEach(btn =>
    btn.addEventListener('click', function () {
      prefs.theme = this.dataset.theme;
      applyTheme(prefs.theme);
      save(prefs);
    }));

  // Font buttons
  document.getElementById('font-decrease').addEventListener('click', function () {
    prefs.fontSize = Math.max(12, prefs.fontSize - 2);
    applyFont(prefs.fontSize); save(prefs);
  });
  document.getElementById('font-increase').addEventListener('click', function () {
    prefs.fontSize = Math.min(32, prefs.fontSize + 2);
    applyFont(prefs.fontSize); save(prefs);
  });

  // Width +/− buttons
  document.getElementById('width-decrease').addEventListener('click', function () {
    prefs.widthPercent = Math.max(40, prefs.widthPercent - 5);
    prefs.widthPercent = applyWidthPercent(prefs.widthPercent);
    save(prefs);
  });
  document.getElementById('width-increase').addEventListener('click', function () {
    prefs.widthPercent = Math.min(95, prefs.widthPercent + 5);
    prefs.widthPercent = applyWidthPercent(prefs.widthPercent);
    save(prefs);
  });

  // Share button
  const shareBtn = document.getElementById('share-btn');
  if (shareBtn) {
    shareBtn.addEventListener('click', function () {
      const url = window.location.origin + shareBtn.dataset.shareUrl;
      navigator.clipboard.writeText(url).then(function () {
        shareBtn.textContent = '✓ Copied!';
        setTimeout(function () { shareBtn.textContent = 'Copy shareable link'; }, 2000);
      });
    });
  }
})();
