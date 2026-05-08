/** Shared auth: adds avatar or sign-in link to the nav on every page.
 *  Include with <script src="/auth.js"></script> before </body>.
 *  Expects a <span id="navAuth"></span> inside the <nav>. */

(function () {
  var API = "https://api.freeappstore.online";
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
        var btn = document.createElement("a");
        btn.className = "nav-signin";
        btn.textContent = "Sign in";
        btn.href = "#";
        btn.onclick = function (e) {
          e.preventDefault();
          fetch(API + "/auth/github/url?redirect=" + encodeURIComponent(window.location.href), { credentials: "include" })
            .then(function (r) { return r.json(); })
            .then(function (d) { if (d.url) window.location.href = d.url; });
        };
        el.appendChild(btn);
      }
    })
    .catch(function () {
      // Auth check failed — show nothing
    });
})();
