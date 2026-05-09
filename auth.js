/** Shared auth + mobile nav: runs on every page.
 *  - Adds avatar or sign-in link to <span id="navAuth">
 *  - Adds hamburger menu button + overlay for mobile nav */

(function () {
  var API = "https://api.freeappstore.online";

  // ── Mobile hamburger menu ──
  var nav = document.querySelector("header nav");
  var headerContainer = document.querySelector("header .container");
  if (nav && headerContainer) {
    // Add hamburger button
    var btn = document.createElement("button");
    btn.className = "nav-toggle";
    btn.setAttribute("aria-label", "Menu");
    btn.innerHTML = "&#9776;";
    headerContainer.appendChild(btn);

    // Add overlay
    var overlay = document.createElement("div");
    overlay.className = "nav-overlay";
    document.body.appendChild(overlay);

    // Add close button inside nav
    var closeBtn = document.createElement("button");
    closeBtn.className = "nav-toggle";
    closeBtn.style.display = "block";
    closeBtn.style.alignSelf = "flex-end";
    closeBtn.style.marginBottom = "0.5rem";
    closeBtn.innerHTML = "&#10005;";
    nav.insertBefore(closeBtn, nav.firstChild);

    function openMenu() { nav.classList.add("open"); overlay.classList.add("open"); }
    function closeMenu() { nav.classList.remove("open"); overlay.classList.remove("open"); }

    btn.addEventListener("click", openMenu);
    closeBtn.addEventListener("click", closeMenu);
    overlay.addEventListener("click", closeMenu);
    // Close on nav link click
    nav.querySelectorAll("a").forEach(function (a) { a.addEventListener("click", closeMenu); });
  }

  // ── Auth avatar ──
  var el = document.getElementById("navAuth");
  if (!el) return;

  fetch(API + "/auth/me", { credentials: "include" })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.user) {
        var img = document.createElement("a");
        img.href = "/profile.html";
        img.title = data.user.name;
        img.innerHTML = '<img class="nav-avatar" src="' + (data.user.photo_url || "") + '" alt="' + data.user.name + '" />';
        el.appendChild(img);
      } else {
        var link = document.createElement("a");
        link.className = "nav-signin";
        link.textContent = "Sign in";
        link.href = "#";
        link.onclick = function (e) {
          e.preventDefault();
          fetch(API + "/auth/github/url?redirect=" + encodeURIComponent(window.location.href), { credentials: "include" })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.url) window.location.href = d.url; });
        };
        el.appendChild(link);
      }
    })
    .catch(function () {});
})();
