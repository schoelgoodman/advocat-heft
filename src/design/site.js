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

  // «Unser Angebot»: die Zeile darunter beginnt genau unter dem Wort. Escape schliesst sie.
  var gruppe = document.querySelector(".nav-gruppe");
  var kopf = document.querySelector(".kopf");
  if (gruppe && kopf) {
    var oben = gruppe.querySelector("a");
    var unter = gruppe.querySelector(".nav-unter");
    function ausrichten() {
      var x = oben.getBoundingClientRect().left - kopf.getBoundingClientRect().left;
      unter.style.setProperty("--unter-x", x + "px");
    }
    ausrichten();
    window.addEventListener("resize", ausrichten);
    gruppe.addEventListener("mouseenter", ausrichten);
    gruppe.addEventListener("focusin", ausrichten);
    gruppe.addEventListener("mouseleave", function () {
      gruppe.classList.remove("zu");
    });
    gruppe.addEventListener("focusout", function (event) {
      if (!gruppe.contains(event.relatedTarget)) gruppe.classList.remove("zu");
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && gruppe.contains(document.activeElement)) {
        gruppe.classList.add("zu");
        oben.focus();
      }
    });
  }

  var logo = document.querySelector(".logo");
  if (logo) {
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
        location.href = "/eingang";
      }, 3000);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (type) {
      logo.addEventListener(type, stopHold);
    });
    logo.addEventListener("click", function (event) {
      if (held) event.preventDefault();
    });
    logo.addEventListener("contextmenu", function (event) {
      if (holdTimer || held) event.preventDefault();
    });
    logo.addEventListener("dragstart", function (event) {
      event.preventDefault();
    });
  }

  var KEY = "d3647bde0281abd69acbb3b62f4568bbd58bd3fa50e8e37d7f3d0594d072e474";
  var typed = "";
  function hex(buffer) {
    return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }
  if (window.crypto && crypto.subtle) {
    document.addEventListener("keydown", function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey || !event.key || event.key.length !== 1) return;
      if (event.target.closest("input, textarea, select, [contenteditable]")) return;
      typed = (typed + event.key.toLowerCase()).slice(-32);
      var tail = typed;
      for (var i = 0; i < tail.length; i++) {
        crypto.subtle.digest("SHA-256", new TextEncoder().encode(tail.slice(i))).then(function (digest) {
          if (hex(digest) === KEY) location.href = "/eingang";
        });
      }
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
    var bild = image.closest("picture") || image;
    bild.replaceWith(button);
    button.appendChild(bild);
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
    // Die Adresse des Archivs steht in der Suche. Patrick kann die Seite umbenennen.
    var archiv = search.getAttribute("action") || "/neuigkeiten";
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

    // Gleicher Aufbau wie articleHtml in layout.ts.
    function render(item) {
      var excerpt = item.excerpt
        ? '<div class="post-content"><p>' + escapeText(item.excerpt) + "</p></div>"
        : "";
      return (
        '<article class="beitrag"><h2 class="entry-title"><a href="' +
        escapeText(item.href) +
        '">' +
        escapeText(item.thema || item.titel) +
        '</a></h2><p class="post-meta"><time datetime="' +
        escapeText(item.datum) +
        '">' +
        escapeText(item.datumAnzeige || "") +
        "</time>" +
        (item.meta ? " · " + escapeText(item.meta) : "") +
        "</p>" +
        excerpt +
        "</article>"
      );
    }

    var status = document.querySelector(".filter-status");
    var yearLinks = document.querySelectorAll(".jahre a");

    // Über der Liste: was gerade gezeigt wird, und der Weg zurück zu allen.
    function show(items, label) {
      list.innerHTML = items.length
        ? items.map(render).join("")
        : '<p class="leer">Keine Beiträge gefunden.</p>';
      if (pager) pager.hidden = true;
      if (status) {
        var count = items.length === 1 ? "1 Beitrag" : items.length + " Beiträge";
        status.innerHTML =
          "<span>" + escapeText(label) + " · " + count + '</span><a href="' + archiv + '">Alle anzeigen</a>';
        status.hidden = false;
      }
    }

    function markYear(year) {
      yearLinks.forEach(function (link) {
        if (link.getAttribute("data-jahr") === year) link.setAttribute("aria-current", "true");
        else link.removeAttribute("aria-current");
      });
    }

    function apply(query) {
      var needle = query.trim().toLowerCase();
      markYear(null);
      show(
        all.filter(function (item) {
          return (item.titel + " " + item.excerpt).toLowerCase().indexOf(needle) !== -1;
        }),
        "Suche nach «" + query.trim() + "»",
      );
    }

    function applyYear(year) {
      markYear(year);
      if (field) field.value = "";
      show(
        all.filter(function (item) {
          return String(item.datum).slice(0, 4) === year;
        }),
        "Newsletter aus " + year,
      );
    }

    var params = new URLSearchParams(location.search);
    var initial = params.get("s") || "";
    var initialYear = params.get("jahr") || "";
    if (initial && field) {
      field.value = initial;
      apply(initial);
    } else if (/^\d{4}$/.test(initialYear)) {
      applyYear(initialYear);
    }
    yearLinks.forEach(function (link) {
      link.addEventListener("click", function (event) {
        event.preventDefault();
        var year = link.getAttribute("data-jahr");
        history.replaceState(null, "", archiv + "?jahr=" + year);
        applyYear(year);
        var top = document.querySelector(".archiv-kopf");
        if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView();
      });
    });
    search.addEventListener("submit", function (event) {
      event.preventDefault();
      var query = field ? field.value : "";
      var url = new URL(location.href);
      url.searchParams.delete("jahr");
      if (query.trim()) url.searchParams.set("s", query.trim());
      else url.searchParams.delete("s");
      history.replaceState(null, "", url.pathname + url.search);
      if (query.trim()) apply(query);
      else location.href = archiv;
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
            if (!response.ok) {
              var serverError = new Error(body.error || "");
              serverError.vomServer = true;
              throw serverError;
            }
          });
        })
        .then(function () {
          form.reset();
          if (thanks) thanks.hidden = false;
        })
        .catch(function (err) {
          fail(
            // Nur die Meldung des Servers zeigen. Ein Netzfehler hätte englischen Browsertext («Failed to fetch»).
            (err && err.vomServer && err.message
              ? err.message + " "
              : err && err.vomServer
                ? ""
                : "Die Nachricht konnte nicht gesendet werden. Bitte prüfen Sie die Verbindung. ") +
              "Sie erreichen uns auch unter office@advocat-finanz.ch.",
          );
        })
        .then(function () {
          if (button) button.disabled = false;
        });
    });
  }
})();
