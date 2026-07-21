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
 * Menüinhalt, Styling und Verhalten liegen ausschließlich hier – wer eine
 * Unterseite hinzufügt, entfernt oder umbenennt, ändert nur die Liste
 * `tools` unten, keine einzelne Seite.
 */
(function () {
    'use strict';

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
        { key: 'ical',          href: 'ical/',          label: 'iCal Terminsuche' },
        { key: 'icaltools',     href: 'icaltools/',     label: 'iCal Tools' },
        { key: 'knallbum',      href: 'knallbum/',      label: 'Knall Bumm' },
        { key: 'laserfeelings', href: 'laserfeelings/', label: 'Laser & Feelings' },
        { key: 'mermaid',       href: 'mermaid/',       label: 'Mermaid Editor' },
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
        'background:#ffffff;border-bottom:1px solid #e4e4e7;z-index:9999;' +
        'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}' +
        '.site-nav a{text-decoration:none;}' +
        '.site-nav-brand{font-weight:700;font-size:15px;letter-spacing:0.3px;color:#27272a;}' +
        '.site-nav-toggle{display:flex;align-items:center;gap:7px;background:none;cursor:pointer;' +
        'border:1px solid #e4e4e7;border-radius:8px;padding:7px 12px;font-size:13px;font-weight:600;' +
        'color:#52525b;font-family:inherit;transition:border-color .15s,color .15s;}' +
        '.site-nav-toggle:hover,.site-nav-toggle[aria-expanded="true"]{border-color:var(--theme-accent);color:var(--theme-accent);}' +
        '.site-nav-menu{position:fixed;top:66px;right:20px;min-width:220px;max-width:calc(100vw - 40px);' +
        'max-height:calc(100vh - 86px);overflow-y:auto;background:#ffffff;border:1px solid #e4e4e7;' +
        'border-radius:10px;box-shadow:0 12px 30px rgba(24,24,27,0.14);padding:6px;z-index:9999;' +
        'display:flex;flex-direction:column;gap:1px;}' +
        '.site-nav-menu[hidden]{display:none;}' +
        '.site-nav-menu a{display:block;padding:9px 12px;border-radius:7px;font-size:13.5px;color:#3f3f46;}' +
        '.site-nav-menu a:hover{background:var(--theme-accent-soft);color:var(--theme-accent);}' +
        '.site-nav-menu a.active{color:var(--theme-accent-strong);font-weight:700;background:var(--theme-accent-soft);}' +
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
