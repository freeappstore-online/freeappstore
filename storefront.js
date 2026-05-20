/**
 * FreeAppStore storefront interactions:
 *   - mode tabs (AI Assistant / Simple Search)
 *   - sort tabs (Featured / Top Rated / Most Active / Popular) — visual only
 *   - split-pane preview (load app in iframe on ≥1024px, navigate to about on <1024px)
 *   - ?app=<id> deep link
 *
 * Theme toggle + mobile nav are handled separately by auth.js so they apply
 * on every page, not just the storefront.
 *
 * Vendored — each store ships its own copy. Don't depend across stores.
 */
(function () {
  // ---------- Mode tabs (AI Assistant / Simple Search) ----------
  (function () {
    var aiWrap = document.getElementById('aiInputWrap');
    var searchWrap = document.getElementById('searchInputWrap');
    var aiInput = document.getElementById('ai-prompt');
    if (!aiWrap || !searchWrap) return;

    document.querySelectorAll('.mode-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('.mode-tab').forEach(function (t) {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        tab.classList.add('active');
        tab.setAttribute('aria-selected', 'true');
        var mode = tab.dataset.mode;
        if (mode === 'ai') {
          aiWrap.hidden = false;
          searchWrap.hidden = true;
          if (aiInput) aiInput.focus();
        } else {
          aiWrap.hidden = true;
          searchWrap.hidden = false;
          var sb = document.getElementById('storefront-search');
          if (sb) sb.focus();
        }
      });
    });

    // AI Assistant has no LLM yet — Enter falls back to simple search.
    if (aiInput) {
      aiInput.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !aiInput.value.trim()) return;
        e.preventDefault();
        var sb = document.getElementById('storefront-search');
        if (!sb) return;
        sb.value = aiInput.value;
        sb.dispatchEvent(new Event('input', { bubbles: true }));
        var searchTab = document.querySelector('.mode-tab[data-mode="search"]');
        if (searchTab) searchTab.click();
      });
    }
  })();

  // ---------- Sort tabs (visual only) ----------
  document.querySelectorAll('.apps-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.apps-tab').forEach(function (t) {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
    });
  });

  // ---------- Split-pane preview ----------
  (function () {
    var pane = document.getElementById('previewPane');
    if (!pane) return;
    var SPLIT_MQ = window.matchMedia('(min-width: 1024px)');
    var frame = document.getElementById('previewFrame');
    var empty = document.getElementById('previewEmpty');
    var title = document.getElementById('previewTitle');
    var btnNewTab = document.getElementById('previewNewTab');
    var btnAbout = document.getElementById('previewAbout');
    var btnClose = document.getElementById('previewClose');
    var current = null; // { id, name, url, aboutUrl }
    var loadTimeout = null;
    var loadToken = 0; // bumped on each loadInPane so stale fetches/timeouts no-op

    // Capture the original empty-state text so we can restore it after an error.
    var emptyTitleEl = empty && empty.querySelector('.empty-title');
    var emptyTipEl = empty && empty.querySelector('.empty-tip');
    var ORIGINAL_EMPTY_TITLE = emptyTitleEl ? emptyTitleEl.textContent : '';
    var ORIGINAL_EMPTY_TIP_HTML = emptyTipEl ? emptyTipEl.innerHTML : '';

    /* SECURITY: the iframe loads app URLs under *.freeappstore.online — all
     * first-party today. Sandbox allows same-origin + scripts because apps need
     * their own cookies / localStorage / fetch to function. Before opening
     * third-party app submissions, revisit this: an untrusted app inside the
     * iframe can currently use its same-origin scope freely. Tightening options
     * include dropping allow-same-origin (breaks stateful apps) or adding
     * `credentialless` once browser support is universal. */
    function restoreEmpty() {
      if (emptyTitleEl) emptyTitleEl.textContent = ORIGINAL_EMPTY_TITLE;
      if (emptyTipEl) emptyTipEl.innerHTML = ORIGINAL_EMPTY_TIP_HTML;
      if (empty) empty.classList.remove('is-error');
    }

    function showLoadError(meta) {
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
      pane.classList.remove('is-loading');
      frame.hidden = true;
      if (empty) {
        empty.hidden = false;
        empty.classList.add('is-error');
        if (emptyTitleEl) emptyTitleEl.textContent = (meta.name || 'This app') + " can't embed here";
        if (emptyTipEl) emptyTipEl.innerHTML = 'It blocks iframes. Click <strong>↗ New tab</strong> to launch it normally.';
      }
    }

    function activate(card) {
      document.querySelectorAll('.app-card.compact.is-active').forEach(function (c) {
        c.classList.remove('is-active');
      });
      if (card) card.classList.add('is-active');
    }

    function setTitle(name, url) {
      var host = '';
      try { host = url ? new URL(url).host : ''; } catch (e) {}
      title.innerHTML = '';
      title.appendChild(document.createTextNode(name || 'No app selected'));
      if (host) {
        var hs = document.createElement('span');
        hs.className = 'preview-host';
        hs.textContent = host;
        title.appendChild(hs);
      }
    }

    function setUrlParam(value) {
      try {
        var u = new URL(window.location.href);
        if (value) u.searchParams.set('app', value);
        else u.searchParams.delete('app');
        history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      } catch (e) {}
    }

    function loadInPane(meta, card) {
      current = meta;
      restoreEmpty();
      pane.classList.add('is-loading');
      frame.hidden = false;
      empty.hidden = true;
      btnNewTab.hidden = false;
      if (btnAbout) btnAbout.hidden = !meta.aboutUrl;
      btnClose.hidden = false;
      setTitle(meta.name, meta.url);
      activate(card);
      setUrlParam(meta.id);

      // Pre-flight reachability: catches DNS NXDOMAIN, unreachable subdomain,
      // connection refused. Browsers fire `load` for their own "site can't be
      // reached" pages, so we can't rely on the iframe load event alone.
      // no-cors so we don't need the target to send CORS headers; we only care
      // whether the fetch throws (network error) or resolves (anything else).
      var token = ++loadToken;
      fetch(meta.url, { method: 'GET', mode: 'no-cors', cache: 'no-store', credentials: 'omit' })
        .then(function () {
          if (token !== loadToken) return; // user clicked another card meanwhile
          frame.src = meta.url;
          if (loadTimeout) clearTimeout(loadTimeout);
          // Safety net: 10s for genuine hangs (rare since fetch already passed).
          loadTimeout = setTimeout(function () { showLoadError(meta); }, 10000);
          frame.addEventListener('load', function once() {
            pane.classList.remove('is-loading');
            frame.removeEventListener('load', once);
            if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
          });
        })
        .catch(function () {
          if (token !== loadToken) return;
          showLoadError(meta);
        });
    }

    function clearPane() {
      current = null;
      loadToken++; // cancel any pending fetch / load handlers
      if (loadTimeout) { clearTimeout(loadTimeout); loadTimeout = null; }
      frame.removeAttribute('src');
      frame.hidden = true;
      empty.hidden = false;
      restoreEmpty();
      btnNewTab.hidden = true;
      if (btnAbout) btnAbout.hidden = true;
      btnClose.hidden = true;
      setTitle(null, '');
      activate(null);
      pane.classList.remove('is-loading');
      setUrlParam(null);
    }

    function cardMeta(card) {
      var cta = card.querySelector('.app-cta');
      var name = card.querySelector('.app-name');
      // .app-name may contain a quality-badge child — only the first text node is the name.
      var nameText = 'App';
      if (name) {
        var n = name.firstChild;
        while (n && n.nodeType !== Node.TEXT_NODE) n = n.nextSibling;
        nameText = (n && n.textContent.trim()) || name.textContent.trim();
      }
      return {
        id: card.dataset.id || '',
        name: nameText,
        url: cta ? cta.getAttribute('href') : null,
        aboutUrl: card.dataset.about || null,
      };
    }

    document.querySelectorAll('#apps-grid .app-card.compact').forEach(function (card) {
      var aboutUrl = card.dataset.about;
      card.style.cursor = 'pointer';
      card.addEventListener('click', function (e) {
        var onCta = !!e.target.closest('.app-cta');
        if (SPLIT_MQ.matches) {
          e.preventDefault();
          loadInPane(cardMeta(card), card);
          return;
        }
        // Single-column: card body → about, CTA → app URL via default <a target="_blank">
        if (!onCta && aboutUrl) window.location.href = aboutUrl;
      });
    });

    if (btnNewTab) btnNewTab.addEventListener('click', function () {
      if (current && current.url) window.open(current.url, '_blank', 'noopener');
    });
    if (btnAbout) btnAbout.addEventListener('click', function () {
      if (current && current.aboutUrl) window.location.href = current.aboutUrl;
    });
    if (btnClose) btnClose.addEventListener('click', clearPane);

    // Deep link: ?app=<id>
    try {
      var wantId = new URLSearchParams(window.location.search).get('app');
      if (wantId && SPLIT_MQ.matches) {
        var match = document.querySelector('#apps-grid .app-card.compact[data-id="' + CSS.escape(wantId) + '"]');
        if (match) loadInPane(cardMeta(match), match);
      }
    } catch (e) {}

    // Viewport shrinks below split breakpoint → clear active state.
    if (SPLIT_MQ.addEventListener) {
      SPLIT_MQ.addEventListener('change', function (e) {
        if (!e.matches) activate(null);
      });
    }
  })();
})();
