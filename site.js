/* ==========================================================================
   Shared behaviour for index.html and report.html.

   IMPORTANT: on report.html this file executes while Markdeep is still the
   raw source text, and Markdeep later replaces document.body.innerHTML
   wholesale. Everything here must therefore either
     (a) attach to `document` / `window` (survives the body swap), or
     (b) run from Site.initReport(), which Markdeep calls via markdeepOptions.onLoad.
   Nothing may cache a reference to an element inside <body> at load time.
   ========================================================================== */

(function () {
  "use strict";

  var TOPBAR_H = 68; /* keep in sync with --topbar-h in style.css */

  /* ------------------------------------------------------------------ */
  /* Lightbox                                                            */
  /* ------------------------------------------------------------------ */

  var lightbox = null;
  var lightboxImg = null;
  var lastFocused = null;
  var closeTimer = null;

  function buildLightbox() {
    /* Built lazily on first use so the node is created *after* Markdeep has
       finished rewriting the body, otherwise it would be thrown away. */
    lightbox = document.createElement("div");
    lightbox.className = "lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Enlarged image");
    lightbox.hidden = true;

    lightboxImg = document.createElement("img");
    lightboxImg.alt = "";

    var close = document.createElement("button");
    close.type = "button";
    close.className = "lightbox-close";
    close.setAttribute("aria-label", "Close enlarged image");
    close.innerHTML = "&times;";

    lightbox.appendChild(lightboxImg);
    lightbox.appendChild(close);
    document.body.appendChild(lightbox);

    lightbox.addEventListener("click", closeLightbox);
    return lightbox;
  }

  function openLightbox(img) {
    if (!lightbox || !lightbox.isConnected) {
      buildLightbox();
    }

    /* Cancel a pending close, or reopening within 180ms would be hidden by it. */
    window.clearTimeout(closeTimer);

    lastFocused = document.activeElement;
    lightboxImg.src = img.getAttribute("data-full") || img.currentSrc || img.src;
    lightboxImg.alt = img.alt || "";
    lightbox.hidden = false;
    document.body.classList.add("lightbox-open");

    /* Next frame so the opacity transition actually runs. */
    requestAnimationFrame(function () {
      lightbox.classList.add("is-open");
      lightbox.querySelector(".lightbox-close").focus();
    });
  }

  function closeLightbox() {
    if (!lightbox || lightbox.hidden) {
      return;
    }

    lightbox.classList.remove("is-open");
    document.body.classList.remove("lightbox-open");

    closeTimer = window.setTimeout(function () {
      lightbox.hidden = true;
      lightboxImg.removeAttribute("src");
    }, 180);

    if (lastFocused && lastFocused.focus) {
      lastFocused.focus();
    }
  }

  /* Delegated on `document` so it keeps working after Markdeep swaps the body. */
  document.addEventListener("click", function (event) {
    var img = event.target.closest ? event.target.closest("img[data-zoomable]") : null;

    if (!img) {
      return;
    }

    /* Never hijack a comparison slider — that would kill the drag handle. */
    if (img.closest(".twentytwenty-container")) {
      return;
    }

    event.preventDefault();
    openLightbox(img);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeLightbox();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Top bar                                                             */
  /* ------------------------------------------------------------------ */

  /* Mirrors the static markup in index.html — keep the two in sync.
     Non-ASCII is written as HTML entities rather than literal characters:
     report.html carries no <meta charset> (nothing may precede its Markdeep
     title), so if this file is ever served without a charset the literals
     would be mis-decoded. Entities are parsed by the HTML parser instead. */
  function topbarHTML(active) {
    return (
      '<div class="topbar">' +
      '<div class="shell">' +
      '<a class="topbar-brand" href="index.html">' +
      "<span>Ya&#287;&#305;z Gen&#231;er</span>" +
      '<span class="sep">/</span>' +
      '<span class="project">Physically-Based Renderer</span>' +
      "</a>" +
      '<nav class="topbar-nav" aria-label="Site">' +
      '<a href="index.html"' +
      (active === "overview" ? ' aria-current="page"' : "") +
      ">Overview</a>" +
      '<a href="report.html"' +
      (active === "report" ? ' aria-current="page"' : "") +
      ">Technical Report</a>" +
      "</nav>" +
      "</div>" +
      "</div>"
    );
  }

  function ensureTopbar(active) {
    if (document.querySelector(".topbar")) {
      return;
    }

    document.body.insertAdjacentHTML("afterbegin", topbarHTML(active));
  }

  /* ------------------------------------------------------------------ */
  /* Report: remove Markdeep's layout debris                             */
  /* ------------------------------------------------------------------ */

  function tidyMarkdeepOutput() {
    /* Markdeep emits the document title as a <title> element inside <body>,
       and leaves ~44 blank <p> elements behind, each of which contributes a
       stray 18px gap. Neither carries content — drop them. */
    Array.prototype.slice
      .call(document.querySelectorAll(".md title"))
      .forEach(function (el) {
        el.parentNode.removeChild(el);
      });

    Array.prototype.slice
      .call(document.querySelectorAll(".md p"))
      .forEach(function (p) {
        /* Keep any paragraph that renders something, including the one that
           carries the trailing <script>/<link> block. */
        if (p.querySelector("img, table, div, svg, mjx-container, a, code, script, link, br")) {
          return;
        }

        if (p.textContent.replace(/[\s ]/g, "") !== "") {
          return;
        }

        p.parentNode.removeChild(p);
      });
  }

  /* ------------------------------------------------------------------ */
  /* Report: table-of-contents sidebar scroll-spy                        */
  /* ------------------------------------------------------------------ */

  function initScrollSpy() {
    var toc = document.querySelector(".longTOC");

    if (!toc) {
      return;
    }

    var links = Array.prototype.slice.call(toc.querySelectorAll("a[href^='#']"));
    var headings = [];

    links.forEach(function (link) {
      /* Markdeep gives headings no id — it emits <a class="target" name="…">
         anchors instead — and those names contain ':' and '/' (e.g.
         "feature2:simpleextrabsdfs2x/roughconductorbsdf"), which are invalid
         in a CSS selector. getElementsByName takes an arbitrary string. */
      var name = link.getAttribute("href").slice(1);

      if (!name) {
        return;
      }

      var target =
        document.getElementsByName(name)[0] || document.getElementById(name);

      if (target) {
        headings.push({ el: target, link: link });
      }
    });

    if (!headings.length) {
      return;
    }

    var current = null;
    var ticking = false;

    function update() {
      ticking = false;

      var threshold = TOPBAR_H + 40;
      var active = headings[0];

      for (var i = 0; i < headings.length; i++) {
        if (headings[i].el.getBoundingClientRect().top <= threshold) {
          active = headings[i];
        } else {
          break;
        }
      }

      /* At the very bottom of the page, favour the last section. */
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 4) {
        active = headings[headings.length - 1];
      }

      if (active === current) {
        return;
      }

      if (current) {
        current.link.classList.remove("is-active");
      }

      active.link.classList.add("is-active");
      current = active;
    }

    function onScroll() {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    update();
  }

  /* ------------------------------------------------------------------ */
  /* Public API                                                          */
  /* ------------------------------------------------------------------ */

  var Site = {
    /* Called from index.html once the DOM is ready. */
    initHome: function () {
      /* Nothing to wire up beyond the delegated handlers above; kept as an
         explicit entry point so both pages read the same way. */
    },

    /* Called from markdeepOptions.onLoad in report.html, i.e. after Markdeep
       has replaced the body and rendered the document. */
    initReport: function () {
      /* Must run before document.title is assigned: Markdeep emits a <title>
         element inside <body>, and `document.title` targets the first <title>
         in tree order, so setting it first would only write into the node
         tidyMarkdeepOutput() is about to delete — leaving the tab unnamed. */
      tidyMarkdeepOutput();

      /* \u escapes for the same charset reason as topbarHTML() — but this is a
         JS string, not markup, so entities would not work here. */
      document.title =
        "Technical Report \u2014 Physically-Based Renderer in C++ " +
        "| Ya\u011f\u0131z Gen\u00e7er";

      /* Markdeep hard-codes <meta name="viewport" content="width=600">, which
         makes the report unusable on phones. Replace every viewport meta. */
      Array.prototype.slice
        .call(document.querySelectorAll("meta[name='viewport']"))
        .forEach(function (meta) {
          meta.parentNode.removeChild(meta);
        });

      var viewport = document.createElement("meta");
      viewport.name = "viewport";
      viewport.content = "width=device-width, initial-scale=1";
      document.head.appendChild(viewport);

      ensureTopbar("report");

      /* Make every standalone figure zoomable, but leave the comparison
         sliders alone. */
      Array.prototype.slice
        .call(document.querySelectorAll(".md img"))
        .forEach(function (img) {
          if (img.closest(".twentytwenty-container, .topbar")) {
            return;
          }

          img.setAttribute("data-zoomable", "");
          img.setAttribute("title", "Click to enlarge");
        });

      initScrollSpy();

      /* twentytwenty measures the rendered image width once, at init. Our CSS
         widens the column and Inter may still be loading, so re-measure after
         both have settled. */
      var remeasure = function () {
        if (window.jQuery) {
          window.jQuery(window).trigger("resize.twentytwenty");
        }
      };

      window.addEventListener("load", remeasure);

      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(remeasure);
      }

      window.setTimeout(remeasure, 400);
    }
  };

  window.Site = Site;
})();
