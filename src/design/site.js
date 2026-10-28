(function () {
  function acceptCookies() {
    try {
      localStorage.setItem("advocat-cookie", "1");
    } catch (error) {
      /* Privater Modus ohne Speicher. */
    }
    document.documentElement.classList.add("cookie-ok");
  }

  var cookieOk = document.querySelector(".cookie-ok");
  var cookieClose = document.querySelector(".cookie-x");
  if (cookieOk) cookieOk.addEventListener("click", acceptCookies);
  if (cookieClose) cookieClose.addEventListener("click", acceptCookies);

  var burger = document.querySelector(".burger");
  var menu = document.getElementById("menu");
  if (burger && menu) {
    burger.addEventListener("click", function () {
      var open = menu.classList.toggle("offen");
      burger.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  var indexNode = document.getElementById("suchindex");
  var search = document.querySelector(".suche");
  var list = document.querySelector(".archiv .beitraege");
  if (indexNode && search && list) {
    var all = [];
    try {
      all = JSON.parse(indexNode.textContent || "[]");
    } catch (error) {
      all = [];
    }
    var pager = document.querySelector(".blaettern");
    var field = search.querySelector("input");

    function escapeText(value) {
      return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
    }

    function render(item) {
      var excerpt = item.excerpt
        ? '<div class="post-content"><p>' + escapeText(item.excerpt) + "</p></div>"
        : "";
      return (
        '<article class="beitrag"><h2 class="entry-title"><a href="' +
        escapeText(item.href) +
        '">' +
        escapeText(item.titel) +
        '</a></h2><p class="post-meta"><time datetime="' +
        escapeText(item.datum) +
        '">' +
        escapeText(item.datumAnzeige || "") +
        "</time></p>" +
        excerpt +
        "</article>"
      );
    }

    function show(items) {
      list.innerHTML = items.length
        ? items.map(render).join("")
        : '<p class="leer">Keine Beiträge gefunden.</p>';
      if (pager) pager.hidden = true;
    }

    function apply(query) {
      var needle = query.trim().toLowerCase();
      show(
        all.filter(function (item) {
          return (item.titel + " " + item.excerpt).toLowerCase().indexOf(needle) !== -1;
        }),
      );
    }

    var params = new URLSearchParams(location.search);
    var initial = params.get("s") || "";
    if (initial && field) {
      field.value = initial;
      apply(initial);
    }
    search.addEventListener("submit", function (event) {
      event.preventDefault();
      var query = field ? field.value : "";
      var url = new URL(location.href);
      if (query.trim()) url.searchParams.set("s", query.trim());
      else url.searchParams.delete("s");
      history.replaceState(null, "", url.pathname + url.search);
      if (query.trim()) apply(query);
      else location.href = "/neuigkeiten";
    });
  }

  var form = document.querySelector(".anfrage");
  if (form) {
    var button = form.querySelector("button[type='submit']");
    var error = form.querySelector(".form-fehler");
    var thanks = form.querySelector(".form-danke");
    function fail(message) {
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      if (thanks) thanks.hidden = true;
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var email = String(data.get("email") || "").trim();
      var complete = ["vorname", "name", "email", "nachricht"].every(function (name) {
        return String(data.get(name) || "").trim();
      });
      if (!complete || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        fail("Bitte füllen Sie alle Felder aus.");
        return;
      }
      var payload = {
        vorname: data.get("vorname"),
        name: data.get("name"),
        email: email,
        nachricht: data.get("nachricht"),
        website: data.get("website"),
      };
      if (error) error.hidden = true;
      if (button) button.disabled = true;
      fetch(form.getAttribute("action") || "/kontakt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          return response.json().catch(function () {
            return {};
          }).then(function (body) {
            if (!response.ok) throw new Error(body.error || "");
          });
        })
        .then(function () {
          form.reset();
          if (thanks) thanks.hidden = false;
        })
        .catch(function (err) {
          fail(
            (err && err.message ? err.message + " " : "") +
              "Sie erreichen uns auch unter office@advocat-finanz.ch.",
          );
        })
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  }
})();
