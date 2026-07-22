/**
 * Gemeinsames, minimales Kopfmenü für alle Seiten.
 *
 * Einbindung: direkt nach dem öffnenden <body>-Tag als NICHT-deferred Script,
 * z. B. <script src="../assets/js/nav.js"></script>. Das Script fügt sich
 * synchron an der eigenen Position ein (document.currentScript), berechnet
 * daraus den relativen Pfad zur Startseite und funktioniert damit sowohl auf
 * GitHub Pages als auch per file://-Doppelklick.
 *
 * Setzt außerdem pro Seitenaufruf zufällig die Verlaufsrichtung und den
 * Akzent-Farbton (siehe assets/css/theme.css, das dafür bereits eingebunden
 * sein muss) und färbt darüber auch das <link rel="icon">-Favicon passend ein.
 *
 * Enthält außerdem den Hell/Dunkel-Umschalter im Menü: ohne manuelle Wahl
 * folgt das Design der Systemeinstellung (prefers-color-scheme, siehe
 * theme.css); die Wahl wird in localStorage gemerkt und gilt seitenübergreifend.
 *
 * Menüinhalt, Styling und Verhalten liegen ausschließlich hier – wer eine
 * Unterseite hinzufügt, entfernt oder umbenennt, ändert nur die Liste
 * `tools` unten, keine einzelne Seite.
 */
(function () {
    'use strict';

    var THEME_KEY = 'klmpfh-theme';
    var THEME_MODES = ['system', 'light', 'dark'];
    var THEME_LABELS = {
        system: '🖥️ Design: System',
        light:  '☀️ Design: Hell',
        dark:   '🌙 Design: Dunkel'
    };

    function getStoredThemeMode() {
        try {
            var stored = localStorage.getItem(THEME_KEY);
            return THEME_MODES.indexOf(stored) !== -1 ? stored : 'system';
        } catch (e) {
            return 'system';
        }
    }

    /** Setzt/entfernt data-theme am <html>-Element – theme.css greift dafür sowohl
     *  per prefers-color-scheme (mode "system") als auch per [data-theme] (mode
     *  "light"/"dark") auf dieselben Farbwerte zu, siehe dortige Kommentare. */
    function applyThemeMode(mode) {
        if (mode === 'light' || mode === 'dark') {
            document.documentElement.setAttribute('data-theme', mode);
        } else {
            document.documentElement.removeAttribute('data-theme');
        }
    }

    // So früh wie möglich anwenden (noch vor dem Rest des Scripts), damit die
    // gespeicherte Wahl nicht erst kurz als Systemeinstellung aufblitzt.
    var currentThemeMode = getStoredThemeMode();
    applyThemeMode(currentThemeMode);

    var scriptEl = document.currentScript;
    var src = scriptEl.getAttribute('src') || '';
    var base = src.replace(/assets\/js\/nav\.js.*$/, '');

    // Zufällige Richtung für den in theme.css definierten Hintergrund-Verlauf,
    // bei jedem Seitenaufruf neu berechnet.
    document.documentElement.style.setProperty('--theme-bg-angle', Math.round(Math.random() * 360) + 'deg');

    // Zufälliger Farbton für die Akzent-/Highlight-Farbe (--theme-accent u.a.
    // in theme.css). Nur der Hue-Winkel wird gewürfelt, Sättigung/Helligkeit
    // sind je Abstufung in theme.css fest hinterlegt und bleiben so konstant.
    document.documentElement.style.setProperty('--theme-accent-hue', Math.round(Math.random() * 360));

    // Favicon in derselben zufälligen Highlight-Farbe einfärben (ersetzt das
    // statische assets/img/favicon.svg durch eine passend eingefärbte
    // Kopie als data:-URI). getComputedStyle liefert --theme-accent bereits
    // mit aufgelöstem Hue-Wert, z. B. "hsl(210, 78%, 45%)".
    var accentColor = getComputedStyle(document.documentElement).getPropertyValue('--theme-accent').trim();
    if (accentColor) {
        var faviconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            + '<rect width="64" height="64" fill="' + accentColor + '"/>'
            + '<text x="32" y="44" font-family="Courier New, Courier, monospace" font-size="40" font-weight="bold" fill="#ffffff" text-anchor="middle">k</text>'
            + '</svg>';
        var faviconLink = document.querySelector('link[rel="icon"]');
        if (faviconLink) faviconLink.href = 'data:image/svg+xml,' + encodeURIComponent(faviconSvg);
    }

    var tools = [
        { key: '',              href: '',               label: 'Start' },
        { key: 'fragezeichen',  href: 'fragezeichen/',  label: '??? Album' },
        { key: 'abz',           href: 'abz/',           label: 'Arbeitszeit-Tracker' },
        { key: 'choose',        href: 'choose/',        label: 'Choose Wisely' },
        { key: 'fileshare',     href: 'fileshare/',     label: 'Fileshare' },
        { key: 'flowchart',     href: 'flowchart/',     label: 'Flowchart' },
        { key: 'ical',          href: 'ical/',          label: 'iCal Terminsuche' },
        { key: 'icaltools',     href: 'icaltools/',     label: 'iCal Tools' },
        { key: 'knallbum',      href: 'knallbum/',      label: 'Knall Bumm' },
        { key: 'laserfeelings', href: 'laserfeelings/', label: 'Laser & Feelings' },
        { key: 'pie',           href: 'pie/',           label: 'Pie' },
        { key: 'sport',         href: 'sport/',         label: 'Sport' },
        { key: 'zauberkloppen', href: 'zauberkloppen/', label: 'Zaubern & Kloppen' }
    ];

    // Aktuelle Seite an der Ordnerstruktur erkennen (funktioniert für
    // ".../abz/", ".../abz/index.html" und "/" bzw. "/index.html").
    var parts = location.pathname.split('/').filter(Boolean);
    var last = parts[parts.length - 1];
    var currentKey = '';
    if (last && last !== 'index.html') {
        currentKey = last;
    } else if (parts.length >= 2) {
        currentKey = parts[parts.length - 2];
    }

    var style = document.createElement('style');
    style.textContent =
        '.site-nav{position:fixed;top:0;left:0;right:0;height:56px;box-sizing:border-box;' +
        'display:flex;align-items:center;justify-content:space-between;padding:0 20px;' +
        'background:var(--theme-surface);border-bottom:1px solid var(--theme-border);z-index:9999;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
        '.site-nav a{text-decoration:none;}' +
        '.site-nav-brand{font-weight:700;font-size:15px;letter-spacing:0.3px;color:var(--theme-text-strong);}' +
        '.site-nav-toggle{display:flex;align-items:center;gap:7px;background:none;cursor:pointer;' +
        'border:1px solid var(--theme-border);border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;' +
        'color:var(--theme-text-muted);font-family:inherit;transition:border-color .15s,color .15s;}' +
        '.site-nav-toggle:hover,.site-nav-toggle[aria-expanded="true"]{border-color:var(--theme-accent);color:var(--theme-accent);}' +
        '.site-nav-menu{position:fixed;top:66px;right:20px;min-width:220px;max-width:calc(100vw - 40px);' +
        'max-height:calc(100vh - 86px);overflow-y:auto;background:var(--theme-surface);border:1px solid var(--theme-border);' +
        'border-radius:10px;box-shadow:var(--theme-shadow);padding:6px;z-index:9999;' +
        'display:flex;flex-direction:column;gap:1px;}' +
        '.site-nav-menu[hidden]{display:none;}' +
        '.site-nav-menu a{display:block;padding:9px 12px;border-radius:7px;font-size:13.5px;color:var(--theme-text);}' +
        '.site-nav-menu a:hover{background:var(--theme-accent-soft);color:var(--theme-accent);}' +
        '.site-nav-menu a.active{color:var(--theme-accent-strong);font-weight:700;background:var(--theme-accent-soft);}' +
        '.site-nav-theme-toggle{display:block;width:100%;text-align:left;background:none;cursor:pointer;' +
        'border:none;border-radius:7px;padding:9px 12px;font-size:13.5px;font-weight:600;' +
        'color:var(--theme-text-muted);font-family:inherit;}' +
        '.site-nav-theme-toggle:hover{background:var(--theme-accent-soft);color:var(--theme-accent);}' +
        '.site-nav-divider{height:1px;background:var(--theme-border);margin:5px 4px;}' +
        '@media (max-width:520px){.site-nav{padding:0 14px;}.site-nav-toggle-label{display:none;}' +
        '.site-nav-toggle{padding:7px 10px;}.site-nav-menu{right:14px;}}';
    document.head.appendChild(style);

    var nav = document.createElement('nav');
    nav.className = 'site-nav';

    var brand = document.createElement('a');
    brand.className = 'site-nav-brand';
    brand.href = base || './';
    brand.textContent = 'klmpfh';

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'site-nav-toggle';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'site-nav-menu');
    toggle.innerHTML = '<span class="site-nav-toggle-label">Menü</span><span aria-hidden="true">&#9776;</span>';

    var menu = document.createElement('div');
    menu.className = 'site-nav-menu';
    menu.id = 'site-nav-menu';
    menu.hidden = true;

    var themeToggle = document.createElement('button');
    themeToggle.type = 'button';
    themeToggle.className = 'site-nav-theme-toggle';
    themeToggle.textContent = THEME_LABELS[currentThemeMode];
    themeToggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var idx = THEME_MODES.indexOf(currentThemeMode);
        currentThemeMode = THEME_MODES[(idx + 1) % THEME_MODES.length];
        try { localStorage.setItem(THEME_KEY, currentThemeMode); } catch (err) { /* localStorage evtl. nicht verfügbar (privater Modus) */ }
        applyThemeMode(currentThemeMode);
        themeToggle.textContent = THEME_LABELS[currentThemeMode];
    });
    menu.appendChild(themeToggle);

    var themeDivider = document.createElement('div');
    themeDivider.className = 'site-nav-divider';
    menu.appendChild(themeDivider);

    tools.forEach(function (tool) {
        var a = document.createElement('a');
        a.href = base + tool.href;
        a.textContent = tool.label;
        if (tool.key === currentKey) a.classList.add('active');
        menu.appendChild(a);
    });

    function closeMenu() {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function (e) {
        e.stopPropagation();
        var wasHidden = menu.hidden;
        menu.hidden = !wasHidden;
        toggle.setAttribute('aria-expanded', String(wasHidden));
    });

    document.addEventListener('click', function (e) {
        if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') closeMenu();
    });

    nav.appendChild(brand);
    nav.appendChild(toggle);
    nav.appendChild(menu);
    scriptEl.insertAdjacentElement('afterend', nav);
})();
