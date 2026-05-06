/**
 * Breaking News dark→light page-load transition.
 *
 * Port of the Hunterbrook WordPress site's `gsap-spotlight.js` to Webflow.
 *
 * Two visual mechanisms running in lockstep:
 *
 * 1) The "spot" — one white circle that uses `mix-blend-mode: difference`
 *    over a pure-black page. Difference blending mathematically inverts
 *    whatever is behind the circle, so as it expands you see "light mode"
 *    sweep across the page even though the underlying DOM is still dark.
 *    When the circle has covered the viewport we do ONE atomic class swap
 *    (remove `data-theme-remove` classes, switch the navbar to base) and
 *    remove the circle.
 *
 * 2) The image filter pipeline — runs in three phases driven by the
 *    `data-breaking-news-reveal` attribute on <html>:
 *
 *      "dark"        → grayscale(100%) invert(100%)
 *                      Image looks like a photo negative — fits the dark
 *                      theme. Applied synchronously at script-execute time
 *                      so images never paint in full colour first.
 *
 *      "reveal-cut"  → contrast(150%) grayscale(100%) invert(0%)
 *                      Hard cut at the moment the spot completes. Image is
 *                      now un-inverted but still B&W and high contrast.
 *
 *      "color-fade"  → contrast(100%) grayscale(0%)
 *                      Animates over 400ms with the same `power1.in` easing
 *                      WordPress uses, restoring full colour.
 *
 *      "done"        → no rule. Image is back to its natural state.
 *
 * 3) The navbar AND the footer are lifted above the spot via z-index during
 *    the reveal so their colours don't get inverted by the spot's blend
 *    mode. Both variant swaps (navbar dark → base, footer light → dark)
 *    are triggered at the START of the spot expansion, not at finish —
 *    CSS transitions on `color`, `fill`, `background-color` etc. are
 *    defined during the "dark" phase too, so the variant class removal
 *    animates over the same 600ms window as the spot. Spot, navbar, and
 *    footer all finish together.
 *
 * 4) Webflow rich-text content (`.w-richtext` p/h1/ul/li/etc.) doesn't
 *    respect combo classes, so we override `color` directly via injected
 *    CSS keyed off the same `data-breaking-news-reveal` attribute. During
 *    `dark` and `reveal-cut` every rich-text descendant is forced white;
 *    on `color-fade` the forced colour is dropped and a `color` transition
 *    is defined, so the text smoothly animates from white to its natural
 *    light-mode colour. Footer rich text is excluded — it has its own
 *    variant swap.
 *
 * No GSAP dependency, no clip-path, no per-element distance math.
 */
(function () {
  if (window.__hbBreakingNewsRevealInitialized) {
    return;
  }
  window.__hbBreakingNewsRevealInitialized = true;

  // ─── CONFIG ────────────────────────────────────────────────────────────────
  var CONFIG = {
    targetSelector: "[data-theme-remove]",
    // Anything inside these stays in its current mode (footer stays dark)
    staticSelector:
      'footer, .section_footer, [data-theme-static="dark"], [data-theme-static="light"]',
    // Scopes that should NOT receive the image-inversion filter
    // (navbar handles itself via Webflow variants; footer stays dark; the
    // spot itself must not be filtered)
    noFilterScopeSelector:
      '[navbar-menu="wrapper"], footer, .section_footer, [data-theme-static]',
    // Rich-text wrappers whose descendants should be forced white during the
    // dark phase and fade to their natural colour during color-fade. Webflow
    // rich-text content (p/h1/ul/li/etc.) is generated and doesn't respect
    // combo classes, so we override `color` directly via injected CSS.
    // Exclude the footer's variant class so the footer rich text is left to
    // its own variant swap.
    richTextSelector: ".w-richtext:not(.footer_rich-text-light)",
    logoSelector: ".navbar_logo-wrapper",
    spotClass: "hb-breaking-news-spot",
    initStyleId: "hb-breaking-news-init-styles",
    spotStyleId: "hb-breaking-news-spot-styles",
    revealAttr: "data-breaking-news-reveal",
    noFilterAttr: "data-bn-no-filter",
    bootDelayMs: 80,
    // Spot expansion: matches WP's `power1.in` over 0.6s
    durationMs: 600,
    easing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
    // Image colour fade: matches WP's `power1.in` over 0.4s
    colorFadeMs: 400,
    colorFadeEasing: "cubic-bezier(0.55, 0.085, 0.68, 0.53)",
  };

  var NAVBAR_CONFIG = {
    wrapperSelector: '[navbar-menu="wrapper"]',
    attr: "data-wf--navbar--variant",
    baseVariant: "base",
    variantClass: "w-variant-ee91e2ce-0996-1f68-beee-d08568e76fe6",
  };

  // Inverse of the navbar: the footer's BASE variant is dark-mode (no
  // variant class). To switch from light → dark we remove the light-mode
  // variant class from the wrapper and every descendant carrying it, and
  // flip the data-wf--footer--variant attribute.
  var FOOTER_CONFIG = {
    wrapperSelector: ".section_footer",
    attr: "data-wf--footer--variant",
    darkVariant: "dark-mode",
    variantClass: "w-variant-6e2fb483-cb49-16a5-7b05-13e0314e820c",
  };

  // ─── EARLY-PHASE INIT ──────────────────────────────────────────────────────
  // Runs synchronously at script execute. Sets the reveal attribute and
  // injects the image-filter CSS so images never paint in full colour before
  // the script's load handler fires.

  function injectInitStyles() {
    if (document.getElementById(CONFIG.initStyleId)) {
      return;
    }

    var head = document.head || document.getElementsByTagName("head")[0];
    if (!head) {
      // <head> not parsed yet — try again on next tick
      window.setTimeout(injectInitStyles, 0);
      return;
    }

    // Filter is applied to <img> NOT inside any noFilter scope and NOT carrying
    // an explicit no-filter / static marker. Each phase corresponds to a
    // value of the [data-breaking-news-reveal] attribute on <html>.
    //
    // The "color-fade" rule extends into "done" too: the identity filter
    // (`contrast(100%) grayscale(0%)`) is visually equivalent to no filter,
    // but `filter` creates a stacking context, and removing the rule at
    // "done" would force the browser to recompose every image layer —
    // causing a one-frame flicker. Keeping the rule active at done avoids
    // that.
    var sel = "img";
    var notNoFilter = ":not([" + CONFIG.noFilterAttr + "])";
    var notStatic = ":not([data-theme-static])";
    var darkSel =
      'html[' + CONFIG.revealAttr + '="dark"] ' + sel + notNoFilter + notStatic;
    var cutSel =
      'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + sel + notNoFilter + notStatic;
    var fadeSel =
      'html[' + CONFIG.revealAttr + '="color-fade"] ' + sel + notNoFilter + notStatic + ", " +
      'html[' + CONFIG.revealAttr + '="done"] ' + sel + notNoFilter + notStatic;

    // Lift the navbar AND footer above the spot during the reveal. Without
    // this the spot's mix-blend-mode would invert their colours — the white
    // logo would briefly turn black, the blue Newsletter badge would turn
    // yellow (difference(white, blue) ≈ yellow), and the footer's light
    // background would invert mid-fade.
    //
    // The footer is normally `position: static` so z-index has no effect —
    // we set `position: relative` to give it a positioning context. This is
    // visually a no-op (the footer stays in normal flow) but allows the
    // z-index to apply.
    //
    // The lift extends into "done" too — removing it would change footer
    // positioning context (relative → static), which can shift any absolute
    // descendants and cause a visible flicker.
    function liftSelector(scope) {
      return (
        'html[' + CONFIG.revealAttr + '="dark"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="color-fade"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="done"] ' + scope
      );
    }
    var navLiftSel = liftSelector(NAVBAR_CONFIG.wrapperSelector);
    var footerLiftSel = liftSelector(FOOTER_CONFIG.wrapperSelector);

    // Smooth the variant swaps. Both navbar (dark→base) and footer
    // (light→dark) variants are removed at the START of the spot animation
    // so they transition in sync with the circle. The transition rule must
    // be defined during the "dark" phase too, otherwise the property change
    // would happen before the transition is registered and snap.
    function transitionSelector(scope) {
      return (
        'html[' + CONFIG.revealAttr + '="dark"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="dark"] ' + scope + " *, " +
        'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + scope + " *, " +
        'html[' + CONFIG.revealAttr + '="color-fade"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="color-fade"] ' + scope + " *"
      );
    }
    var navTransitionSel = transitionSelector(NAVBAR_CONFIG.wrapperSelector);
    var footerTransitionSel = transitionSelector(FOOTER_CONFIG.wrapperSelector);

    // Rich-text descendants are forced white during the dark phase
    // (reveal-cut included so the colour stays white right up to finish)
    // then animate to natural via the color-fade rule below.
    var richTextWhiteSel =
      'html[' + CONFIG.revealAttr + '="dark"] ' + CONFIG.richTextSelector + ", " +
      'html[' + CONFIG.revealAttr + '="dark"] ' + CONFIG.richTextSelector + " *, " +
      'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + CONFIG.richTextSelector + ", " +
      'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + CONFIG.richTextSelector + " *";
    // Color-fade phase: drop the forced colour and animate `color` to the
    // natural value (which is now light-mode after the class swap at finish).
    // Extends into "done" so the transition declaration doesn't disappear at
    // the same instant other rules deactivate, which would compound recompose
    // work into the same frame.
    var richTextFadeSel =
      'html[' + CONFIG.revealAttr + '="color-fade"] ' + CONFIG.richTextSelector + ", " +
      'html[' + CONFIG.revealAttr + '="color-fade"] ' + CONFIG.richTextSelector + " *, " +
      'html[' + CONFIG.revealAttr + '="done"] ' + CONFIG.richTextSelector + ", " +
      'html[' + CONFIG.revealAttr + '="done"] ' + CONFIG.richTextSelector + " *";

    // Reusable transition declaration for chrome (navbar + footer)
    var chromeTransition = [
      "  transition:",
      "    color " + CONFIG.durationMs + "ms " + CONFIG.easing + ",",
      "    background-color " + CONFIG.durationMs + "ms " + CONFIG.easing + ",",
      "    fill " + CONFIG.durationMs + "ms " + CONFIG.easing + ",",
      "    stroke " + CONFIG.durationMs + "ms " + CONFIG.easing + ",",
      "    border-color " + CONFIG.durationMs + "ms " + CONFIG.easing + ",",
      "    opacity " + CONFIG.durationMs + "ms " + CONFIG.easing + ";",
    ];

    var lines = [
      darkSel + " {",
      "  filter: grayscale(100%) invert(100%);",
      "}",
      cutSel + " {",
      "  filter: contrast(150%) grayscale(100%) invert(0%);",
      "  transition: none;",
      "}",
      fadeSel + " {",
      "  filter: contrast(100%) grayscale(0%);",
      "  transition: filter " + CONFIG.colorFadeMs + "ms " + CONFIG.colorFadeEasing + ";",
      "}",
      navLiftSel + " {",
      "  z-index: 2147483647 !important;",
      "}",
      // Footer is normally position: static — needs `position: relative` for
      // z-index to take effect. This doesn't change layout (footer is still
      // in normal flow) but creates a positioning context.
      footerLiftSel + " {",
      "  position: relative !important;",
      "  z-index: 2147483647 !important;",
      "}",
      // Rich-text: white during dark/reveal-cut, then animate to natural
      // colour during color-fade. Webflow rich-text descendants don't
      // respect combo classes, so we force the colour directly.
      richTextWhiteSel + " {",
      "  color: #ffffff !important;",
      "}",
      richTextFadeSel + " {",
      "  transition: color " +
        CONFIG.colorFadeMs + "ms " + CONFIG.colorFadeEasing + ";",
      "}",
      // Footer rich text in dark-mode: force white (Webflow's footer
      // dark-mode variant doesn't restyle rich-text descendants, so the
      // text would otherwise stay at its light-mode colour). This rule is
      // phase-independent — keys off the footer's own variant attribute —
      // so it applies the moment swapFooterOnce() flips the attribute and
      // stays applied for good. The existing footerTransitionSel rule
      // animates `color` over 600ms, so the text smoothly fades from its
      // light-mode colour to white during the spot expansion.
      ".section_footer[" + FOOTER_CONFIG.attr + "=\"" + FOOTER_CONFIG.darkVariant + "\"] .footer_rich-text-light, " +
      ".section_footer[" + FOOTER_CONFIG.attr + "=\"" + FOOTER_CONFIG.darkVariant + "\"] .footer_rich-text-light * {",
      "  color: #ffffff !important;",
      "}",
      navTransitionSel + " {",
    ]
      .concat(chromeTransition)
      .concat(["}", footerTransitionSel + " {"])
      .concat(chromeTransition)
      .concat([
        "}",
        "@media (prefers-reduced-motion: reduce) {",
        "  " + darkSel + ", " + cutSel + ", " + fadeSel + " {",
        "    filter: none !important;",
        "    transition: none !important;",
        "  }",
        "  " + navTransitionSel + ", " + footerTransitionSel + " {",
        "    transition: none !important;",
        "  }",
        "  " + richTextWhiteSel + " {",
        "    color: inherit !important;",
        "  }",
        "  " + richTextFadeSel + " {",
        "    transition: none !important;",
        "  }",
        "}",
      ]);

    var css = lines.join("\n");

    var style = document.createElement("style");
    style.id = CONFIG.initStyleId;
    style.textContent = css;
    head.appendChild(style);
  }

  function markNoFilterScopes() {
    if (!document.body) return;

    document
      .querySelectorAll(CONFIG.noFilterScopeSelector)
      .forEach(function (el) {
        el.setAttribute(CONFIG.noFilterAttr, "");
      });
  }

  function initEarlyState() {
    if (document.documentElement) {
      document.documentElement.setAttribute(CONFIG.revealAttr, "dark");
    }

    injectInitStyles();

    if (document.body) {
      markNoFilterScopes();
    } else {
      document.addEventListener("DOMContentLoaded", markNoFilterScopes, { once: true });
    }
  }

  initEarlyState();

  // ─── HELPERS ───────────────────────────────────────────────────────────────
  function splitClassNames(value) {
    return String(value || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
  }

  function getTargets() {
    return Array.from(document.querySelectorAll(CONFIG.targetSelector)).filter(
      function (el) { return !el.closest(CONFIG.staticSelector); }
    );
  }

  function removeDarkThemeClasses(targets) {
    targets.forEach(function (target) {
      splitClassNames(target.getAttribute("data-theme-remove")).forEach(
        function (cls) { target.classList.remove(cls); }
      );
    });
  }

  // ─── NAVBAR ────────────────────────────────────────────────────────────────
  function setNavbarBaseMode() {
    if (
      window.HunterbrookNav &&
      typeof window.HunterbrookNav.setNavbarBase === "function"
    ) {
      window.HunterbrookNav.setNavbarBase();
      return;
    }

    document.querySelectorAll(NAVBAR_CONFIG.wrapperSelector).forEach(
      function (wrapper) {
        wrapper.classList.remove(NAVBAR_CONFIG.variantClass);
        wrapper.querySelectorAll("*").forEach(function (el) {
          el.classList.remove(NAVBAR_CONFIG.variantClass);
        });
        wrapper.setAttribute(NAVBAR_CONFIG.attr, NAVBAR_CONFIG.baseVariant);
      }
    );

    window.dispatchEvent(new Event("resize"));
  }

  // ─── FOOTER ────────────────────────────────────────────────────────────────
  // Footer goes the opposite direction of the navbar: from light → dark.
  // Default in Webflow is light-mode (variant class present); we remove that
  // class from the wrapper and every descendant carrying it, and flip the
  // data-wf--footer--variant attribute to "dark-mode".
  function setFooterDarkMode() {
    document.querySelectorAll(FOOTER_CONFIG.wrapperSelector).forEach(
      function (footer) {
        footer.classList.remove(FOOTER_CONFIG.variantClass);
        footer.querySelectorAll("*").forEach(function (el) {
          el.classList.remove(FOOTER_CONFIG.variantClass);
        });
        footer.setAttribute(FOOTER_CONFIG.attr, FOOTER_CONFIG.darkVariant);
      }
    );
  }

  // ─── ORIGIN & SCALE ────────────────────────────────────────────────────────
  function getOrigin() {
    var logo = document.querySelector(CONFIG.logoSelector);

    if (!logo) {
      return { x: 72, y: 40 };
    }

    var rect = logo.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }

  // Matches WP: max(viewport width, height) × 2.5
  function getSpotScale() {
    return Math.max(window.innerWidth, window.innerHeight) * 2.5;
  }

  // ─── SPOT STYLES ───────────────────────────────────────────────────────────
  // Near-1:1 port of WP's spot4.css
  function ensureSpotStyles() {
    if (document.getElementById(CONFIG.spotStyleId)) {
      return;
    }

    var css = [
      "." + CONFIG.spotClass + " {",
      "  position: fixed;",
      "  top: 0;",
      "  left: 0;",
      "  width: 1px;",
      "  height: 1px;",
      "  border-radius: 50%;",
      "  background-color: #ffffff;",
      "  transform: translate(-50%, -50%);",
      "  pointer-events: none;",
      "  z-index: 2147483646;",
      "  mix-blend-mode: difference;",
      "  -webkit-backdrop-filter: contrast(150%);",
      "  backdrop-filter: contrast(150%);",
      "  will-change: width, height;",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  ." + CONFIG.spotClass + " { display: none !important; }",
      "}",
    ].join("\n");

    var style = document.createElement("style");
    style.id = CONFIG.spotStyleId;
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ─── SPOT ──────────────────────────────────────────────────────────────────
  function createSpot(origin) {
    var spot = document.createElement("div");
    spot.className = CONFIG.spotClass;
    // Spot is itself an element on the page — it must not be filtered
    spot.setAttribute(CONFIG.noFilterAttr, "");
    spot.style.top = origin.y + "px";
    spot.style.left = origin.x + "px";
    document.body.appendChild(spot);
    return spot;
  }

  // ─── REVEAL STATE ──────────────────────────────────────────────────────────
  function setRevealState(state) {
    document.documentElement.setAttribute(CONFIG.revealAttr, state);
  }

  // ─── MAIN ──────────────────────────────────────────────────────────────────
  function runReveal() {
    var targets = getTargets();

    if (!targets.length) {
      // Nothing to swap — clear the dark filter so images don't get stuck
      setRevealState("done");
      return;
    }

    // Reduced-motion: skip the animation, just swap modes immediately
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      removeDarkThemeClasses(targets);
      setNavbarBaseMode();
      setFooterDarkMode();
      setRevealState("done");
      return;
    }

    // Make sure no-filter scopes are marked even if DOMContentLoaded was
    // missed (e.g. script loaded after document was already ready)
    markNoFilterScopes();

    ensureSpotStyles();

    var origin = getOrigin();
    var scale = getSpotScale();
    var spot = createSpot(origin);

    var swapped = false;
    var navbarSwapped = false;
    var footerSwapped = false;

    function swapNavbarOnce() {
      if (navbarSwapped) return;
      navbarSwapped = true;
      // Triggers the variant class removal. The CSS transition rules defined
      // for the "dark" phase animate the colour change over CONFIG.durationMs,
      // so the navbar fades into base mode in lockstep with the spot.
      setNavbarBaseMode();
    }

    function swapFooterOnce() {
      if (footerSwapped) return;
      footerSwapped = true;
      // Same mechanism as the navbar but in the inverse direction —
      // light-mode variant class is removed so the footer falls back to its
      // base (dark) variant. CSS transitions handle the colour fade.
      setFooterDarkMode();
    }

    function finish() {
      if (swapped) return;
      swapped = true;

      // 1. Atomic mode swap — by now the white circle covers the viewport,
      //    so changing classes is invisible to the user. Navbar/footer were
      //    already swapped at the start of the animation, but call again as
      //    a safety net in case the early calls were missed.
      removeDarkThemeClasses(targets);
      swapNavbarOnce();
      swapFooterOnce();

      // 2. Hard cut on images: from inverted-grayscale to non-inverted-grayscale
      //    (still B&W, high contrast). Spot is removed at the same moment.
      setRevealState("reveal-cut");

      if (spot.parentNode) {
        spot.parentNode.removeChild(spot);
      }

      // 3. Force a reflow so the cut state actually flushes before we apply
      //    the next state with its transition. Without this the browser may
      //    coalesce the two state changes and skip the transition.
      void document.documentElement.offsetHeight;

      // 4. Next frame: animate to full colour over colorFadeMs
      window.requestAnimationFrame(function () {
        setRevealState("color-fade");

        window.setTimeout(function () {
          setRevealState("done");
        }, CONFIG.colorFadeMs + 40);
      });
    }

    // Two rAF frames so the spot paints at 1px before its size transition
    // is applied. Without this the browser may coalesce start and end states
    // into a single layout pass and skip the animation entirely.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        spot.style.transition =
          "width " + CONFIG.durationMs + "ms " + CONFIG.easing +
          ", height " + CONFIG.durationMs + "ms " + CONFIG.easing;
        spot.style.width = scale + "px";
        spot.style.height = scale + "px";

        // Trigger the navbar AND footer variant swaps NOW so their colour
        // transitions play out alongside the spot expansion (both 600ms,
        // same easing, all three finish together — navbar dark→base,
        // footer light→dark, spot at full coverage).
        swapNavbarOnce();
        swapFooterOnce();

        // Safety net: if transitionend doesn't fire (e.g. tab inactive,
        // animation interrupted) we still complete the swap on a timer
        var safetyTimer = window.setTimeout(finish, CONFIG.durationMs + 80);

        spot.addEventListener("transitionend", function onEnd(ev) {
          if (ev.propertyName !== "width") return;
          window.clearTimeout(safetyTimer);
          finish();
        });
      });
    });
  }

  // ─── BOOT ──────────────────────────────────────────────────────────────────
  function boot() {
    window.setTimeout(runReveal, CONFIG.bootDelayMs);
  }

  if (document.readyState === "complete") {
    boot();
  } else {
    window.addEventListener("load", boot, { once: true });
  }
})();
