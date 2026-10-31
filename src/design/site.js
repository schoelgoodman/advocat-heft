(function () {
  // Google Maps lädt erst auf Klick; vorher geht nichts an Google.
  var mapButton = document.querySelector(".karte-laden");
  if (mapButton) {
    mapButton.addEventListener("click", function () {
      var holder = mapButton.closest(".karte-platzhalter");
      var frame = document.createElement("iframe");
      frame.className = "karte-frame";
      frame.src = holder.getAttribute("data-src");
      frame.title = holder.getAttribute("data-title");
      frame.setAttribute("referrerpolicy", "no-referrer-when-downgrade");
      holder.replaceWith(frame);
    });
  }

  var burger = document.querySelector(".burger");
  var menu = document.getElementById("menu");
  if (burger && menu) {
    function setMenu(open) {
      menu.classList.toggle("offen", open);
      burger.setAttribute("aria-expanded", open ? "true" : "false");
      burger.setAttribute("aria-label", open ? "Menü schliessen" : "Menü");
    }
    burger.addEventListener("click", function () {
      setMenu(!menu.classList.contains("offen"));
    });
    menu.addEventListener("click", function (event) {
      if (event.target.closest("a")) setMenu(false);
    });
    document.addEventListener("click", function (event) {
      if (menu.classList.contains("offen") && !event.target.closest(".kopf")) setMenu(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.classList.contains("offen")) {
        setMenu(false);
        burger.focus();
      }
    });
  }

  // Versteckter Weg in die Redaktion: Logo 3 Sekunden gedrückt halten, oder irgendwo auf der
  // Seite das Wort tippen. Die Redaktion selbst verlangt weiterhin das Login.
  var logo = document.querySelector(".logo[data-redaktion]");
  if (logo) {
    var redaktion = logo.getAttribute("data-redaktion");
    var holdTimer = null;
    var held = false;
    function stopHold() {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    logo.addEventListener("pointerdown", function (event) {
      if (event.button !== 0) return;
      held = false;
      stopHold();
      holdTimer = setTimeout(function () {
        held = true;
        location.href = redaktion;
      }, 3000);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (type) {
      logo.addEventListener(type, stopHold);
    });
    // Nach dem Halten nicht noch auf die Startseite springen; das Menü vom langen Drücken unterdrücken.
    logo.addEventListener("click", function (event) {
      if (held) event.preventDefault();
    });
    logo.addEventListener("contextmenu", function (event) {
      if (holdTimer || held) event.preventDefault();
    });
    logo.addEventListener("dragstart", function (event) {
      event.preventDefault();
    });

    var WORD = "rosalieohrosalie";
    var typed = "";
    document.addEventListener("keydown", function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.key.length !== 1) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      typed = (typed + event.key.toLowerCase()).slice(-WORD.length);
      if (typed === WORD) location.href = redaktion;
    });
  }

  // Bilder im Newsletter, die kleiner als ihre echte Grösse erscheinen (z.B. Tabellen auf dem
  // Handy), lassen sich antippen und in voller Grösse ansehen.
  var zoomDialog = null;
  function openZoom(image) {
    if (!zoomDialog) {
      zoomDialog = document.createElement("dialog");
      zoomDialog.className = "bild-gross";
      zoomDialog.setAttribute("aria-label", "Bild in voller Grösse");
      zoomDialog.innerHTML = '<button type="button" class="bild-gross-zu" aria-label="Schliessen">×</button><div class="bild-gross-flaeche"></div>';
      zoomDialog.addEventListener("click", function (event) {
        if (event.target === zoomDialog || event.target.closest(".bild-gross-zu")) zoomDialog.close();
      });
      document.body.appendChild(zoomDialog);
    }
    var copy = document.createElement("img");
    copy.src = image.currentSrc || image.src;
    copy.alt = image.alt;
    copy.width = image.naturalWidth;
    zoomDialog.querySelector(".bild-gross-flaeche").replaceChildren(copy);
    zoomDialog.showModal();
  }
  function markZoomable(image) {
    if (image.closest("a, .bild-zoom")) return;
    if (image.naturalWidth < image.clientWidth * 1.3) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "bild-zoom";
    button.setAttribute("aria-label", "Bild vergrössern" + (image.alt ? ": " + image.alt : ""));
    image.replaceWith(button);
    button.appendChild(image);
    button.addEventListener("click", function () {
      openZoom(image);
    });
  }
  document.querySelectorAll(".einzel .prosa img").forEach(function (image) {
    if (image.complete) markZoomable(image);
    else image.addEventListener("load", function () { markZoomable(image); }, { once: true });
  });

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

    // Fehler direkt am Feld: roter Rahmen, Satz darunter, vorgelesen über aria-describedby.
    var MISSING = {
      vorname: "Bitte geben Sie Ihren Vornamen ein.",
      name: "Bitte geben Sie Ihren Namen ein.",
      email: "Bitte geben Sie Ihre E-Mail-Adresse ein.",
      nachricht: "Bitte schreiben Sie uns eine Nachricht.",
    };
    function fieldError(name, message) {
      var field = form.elements[name];
      var note = document.getElementById("fehler-" + name);
      if (!field || !note) return;
      note.textContent = message || "";
      note.hidden = !message;
      if (message) field.setAttribute("aria-invalid", "true");
      else field.removeAttribute("aria-invalid");
    }
    Object.keys(MISSING).forEach(function (name) {
      var field = form.elements[name];
      if (field) field.addEventListener("input", function () {
        if (field.getAttribute("aria-invalid")) fieldError(name, "");
      });
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var data = new FormData(form);
      var email = String(data.get("email") || "").trim();
      var first = null;
      Object.keys(MISSING).forEach(function (name) {
        var value = String(data.get(name) || "").trim();
        var message = !value
          ? MISSING[name]
          : name === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
            ? "Diese E-Mail-Adresse scheint nicht zu stimmen."
            : "";
        fieldError(name, message);
        if (message && !first) first = form.elements[name];
      });
      if (first) {
        if (error) error.hidden = true;
        if (thanks) thanks.hidden = true;
        first.focus();
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
