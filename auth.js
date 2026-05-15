/** Shared auth + mobile nav: runs on every page.
 *  - Adds avatar or sign-in link to <span id="navAuth">
 *  - Adds hamburger menu button + overlay for mobile nav */

(function () {
  var API = "https://api.freeappstore.online";

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
