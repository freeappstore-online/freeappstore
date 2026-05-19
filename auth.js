/** Shared auth + mobile nav + theme toggle: runs on every page.
 *  - Applies stored or system theme (storefront also applies it inline in <head>
 *    to avoid flash; this handles non-storefront pages that lack the preload).
 *  - Injects a moon/sun theme-toggle button into the header on pages that
 *    don't already have one (the storefront ships it in the template).
 *  - Adds avatar or sign-in link to <span id="navAuth">.
 *  - Adds hamburger menu button + overlay for mobile nav. */

(function () {
  var API = "https://api.freeappstore.online";

  // ── Theme: apply stored / preferred mode ──
  try {
    var stored = localStorage.getItem("fas-theme");
    var preferDark = stored ? stored === "dark"
      : window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (preferDark) document.documentElement.classList.add("dark");
  } catch (e) {}

  // ── Theme toggle button (skip if storefront already shipped one) ──
  if (!document.getElementById("themeToggle")) {
    var headerC = document.querySelector("header .container");
    if (headerC) {
      var tt = document.createElement("button");
      tt.id = "themeToggle";
      tt.className = "theme-toggle";
      tt.type = "button";
      tt.setAttribute("aria-label", "Toggle dark mode");
      tt.title = "Toggle dark mode";
      tt.innerHTML =
        '<svg class="icon-moon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' +
        '<svg class="icon-sun" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
      // Insert just before the navAuth (or at the start of header container)
      var anchor = document.getElementById("navAuth");
      if (anchor && anchor.parentNode) {
        anchor.parentNode.insertBefore(tt, anchor);
      } else {
        headerC.appendChild(tt);
      }
    }
  }
  // Wire click on whichever toggle ended up in the DOM.
  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn && !themeBtn.dataset.bound) {
    themeBtn.dataset.bound = "1";
    themeBtn.addEventListener("click", function () {
      var isDark = document.documentElement.classList.toggle("dark");
      try { localStorage.setItem("fas-theme", isDark ? "dark" : "light"); } catch (e) {}
    });
  }

  // ── Mobile hamburger menu ──
  var nav = document.querySelector("header nav");
  var headerContainer = document.querySelector("header .container");
  if (nav && headerContainer) {
    var btn = document.createElement("button");
    btn.className = "nav-toggle";
    btn.setAttribute("aria-label", "Menu");
    btn.innerHTML = "&#9776;";
    headerContainer.appendChild(btn);

    var overlay = document.createElement("div");
    overlay.className = "nav-overlay";
    document.body.appendChild(overlay);

    var closeBtn = document.createElement("button");
    closeBtn.className = "nav-close";
    closeBtn.setAttribute("aria-label", "Close menu");
    closeBtn.innerHTML = "&#10005;";
    nav.insertBefore(closeBtn, nav.firstChild);

    function openMenu() { nav.classList.add("open"); overlay.classList.add("open"); }
    function closeMenu() { nav.classList.remove("open"); overlay.classList.remove("open"); }

    btn.addEventListener("click", openMenu);
    closeBtn.addEventListener("click", closeMenu);
    overlay.addEventListener("click", closeMenu);
    nav.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });
  }

  // ── Auth avatar ──
  var el = document.getElementById("navAuth");
  if (!el) return;

  // Check localStorage for cached session (same key as @freeappstore/sdk)
  var session = null;
  try {
    var raw = localStorage.getItem("fas:session");
    if (raw) session = JSON.parse(raw);
  } catch (e) {}

  if (session && session.token && session.user) {
    showUser(session.user);
    // Verify session is still valid in background
    fetch(API + "/v1/auth/me", { headers: { Authorization: "Bearer " + session.token } })
      .then(function (r) { if (!r.ok) { localStorage.removeItem("fas:session"); location.reload(); } })
      .catch(function () {});
  } else {
    // Check for OAuth callback hash
    var hash = window.location.hash;
    if (hash.indexOf("#fas_session=") === 0) {
      var token = decodeURIComponent(hash.slice("#fas_session=".length));
      history.replaceState(null, "", window.location.pathname + window.location.search);
      if (token) {
        fetch(API + "/v1/auth/me", { headers: { Authorization: "Bearer " + token } })
          .then(function (r) { return r.json(); })
          .then(function (user) {
            if (user && user.id) {
              localStorage.setItem("fas:session", JSON.stringify({ token: token, user: user }));
              showUser(user);
            } else {
              showSignIn();
            }
          })
          .catch(function () { showSignIn(); });
        return;
      }
    }
    showSignIn();
  }

  function showUser(user) {
    var a = document.createElement("a");
    a.href = "https://create.freeappstore.online/profile";
    a.title = user.login || "Profile";
    if (user.avatarUrl) {
      var img = document.createElement("img");
      img.className = "nav-avatar";
      img.src = user.avatarUrl;
      img.alt = user.login || "";
      a.appendChild(img);
    } else {
      a.textContent = user.login || "Profile";
      a.className = "nav-signin";
    }
    el.appendChild(a);
  }

  function showSignIn() {
    var link = document.createElement("a");
    link.className = "nav-signin";
    link.textContent = "Sign in";
    link.href = "#";
    link.onclick = function (e) {
      e.preventDefault();
      var url = new URL("/v1/auth/github/start", API);
      url.searchParams.set("app_id", "store");
      url.searchParams.set("return_to", window.location.href);
      window.location.href = url.toString();
    };
    el.appendChild(link);
  }
})();
