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
 * 3) NAVBAR transition strategy (revised in v7): the navbar wrapper is
 *    NOT lifted above the spot — we let the spot's `mix-blend-mode:
 *    difference` paint over the navbar, so the bg, logo, and hamburger
 *    icon visually invert in lockstep with the spot's edge sweeping over
 *    them. This matches the WordPress reference and keeps the navbar
 *    transition perfectly synced with the rest of the page reveal. The
 *    only navbar element lifted above the spot is `.navbar_newsletter-
 *    button` — without that lift the difference blend would turn the blue
 *    badge yellow. The variant swap (dark → base) fires at finish() (the
 *    moment the spot completes) and is atomic: the underlying DOM snaps
 *    to the state the blend was already showing, so removing the spot is
 *    visually seamless.
 *
 *    The FOOTER wrapper is still lifted (the footer is below the fold for
 *    most viewports during the reveal and contains non-grayscale form
 *    elements). Its variant swap also fires at finish().
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

  // Build marker so we can confirm in the debug overlay / console which
  // revision of the script is actually executing on the page (rules out
  // stale cache / un-republished embed when troubleshooting).
  var HB_BUILD = "v7-navbar-blend-reveal";
  try { console.log("[hb-bn] build", HB_BUILD); } catch (_) {}

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

    // Lift strategy (revised in v7):
    //
    //   - The NAVBAR WRAPPER is NOT lifted. We deliberately let the spot's
    //     `mix-blend-mode: difference` paint over it so the bg/logo/menu
    //     icon visually invert in lockstep with the spot's edge sweeping
    //     across the navbar. This is what WordPress does and is the only
    //     way to keep the navbar transition synced with the spot expansion
    //     while avoiding a gray-on-gray crossover (any monotonic colour
    //     transition between grayscale opposites must pass through a moment
    //     where logo and bg have the same RGB value — see the chrome
    //     transition comment below).
    //
    //   - `.navbar_newsletter-button` IS lifted above the spot. It's the
    //     only non-grayscale element in the navbar; without lifting it the
    //     difference blend would turn the blue badge yellow mid-reveal.
    //     The Webflow `<a>` is `position: static` by default so we also set
    //     `position: relative` to give the z-index a positioning context.
    //
    //   - The FOOTER WRAPPER is still lifted. The footer is below the fold
    //     during the reveal on most viewports, but we lift it as a belt-and-
    //     -braces so its non-grayscale elements (newsletter form, etc.)
    //     don't invert if the user happens to have it in view.
    //
    //   - The Newsletter / footer lifts extend into "done" too — removing
    //     `position: relative` mid-frame would change the footer/newsletter's
    //     positioning context (relative → static) and shift any absolutely
    //     positioned descendants, producing a visible flicker.
    function liftSelector(scope) {
      return (
        'html[' + CONFIG.revealAttr + '="dark"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="reveal-cut"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="color-fade"] ' + scope + ", " +
        'html[' + CONFIG.revealAttr + '="done"] ' + scope
      );
    }
    var newsletterLiftSel = liftSelector(
      NAVBAR_CONFIG.wrapperSelector + " .navbar_newsletter-button"
    );
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

    // ─── LOGO TRANSITION OVERRIDE ─────────────────────────────────────────────
    // The navbar's embedded helper script injects a separate transition rule
    // specifically targeting the logo wrapper:
    //
    //   [navbar-menu="wrapper"][data-wf--navbar--variant="base"]
    //     .navbar_logo-wrapper { transition: color 500ms ease; }
    //
    // That rule has specificity (0,3,0) — higher than the navTransitionSel
    // rule above, which is (0,2,1) — so during the reveal the logo wrapper
    // gets the embed's 500ms `ease` curve instead of our 600ms power1.in.
    //
    // The mismatch is what produces the mobile "logo blink": `ease` is fast
    // out of the gate while `power1.in` is slow out of the gate, so by
    // ~mid-animation the logo `color` is already mostly at its final dark
    // value while the navbar `background-color` is barely off black —
    // dark-ish logo on still-dark background = invisible for ~300ms.
    //
    // Fix: a logo-wrapper-specific rule with specificity (0,3,1) — beats the
    // embed's (0,3,0) — that re-asserts our 600ms power1.in transition for
    // the reveal phases. Outside the reveal the embed's rule still wins, so
    // the embed's mobile-menu open/close logo transition is preserved.
    var logoTransitionSel =
      'html[' + CONFIG.revealAttr + '="dark"] ' +
      NAVBAR_CONFIG.wrapperSelector + " .navbar_logo-wrapper, " +
      'html[' + CONFIG.revealAttr + '="reveal-cut"] ' +
      NAVBAR_CONFIG.wrapperSelector + " .navbar_logo-wrapper, " +
      'html[' + CONFIG.revealAttr + '="color-fade"] ' +
      NAVBAR_CONFIG.wrapperSelector + " .navbar_logo-wrapper";

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

    // Chrome (navbar + footer) transitions are FORCED OFF during the reveal.
    // The visual transition for the navbar comes from the spot's
    // `mix-blend-mode: difference` painting over it (see lift comment), not
    // from CSS colour transitions. We still need to suppress transitions
    // here so:
    //   1) The navbar embed's own `transition: color 500ms ease` rule on the
    //      logo wrapper doesn't fire when the variant class is removed at
    //      finish() — that would cause the actual logo colour to fade over
    //      500ms even though the spot's blend has already revealed it as
    //      dark, producing a brief mismatch between the inverted-via-blend
    //      state and the actual underlying state.
    //   2) The Webflow variant transitions on bg/colour don't fire either.
    //      The blend reveal IS the transition — we want the underlying DOM
    //      state to snap atomically at finish() so it matches what the blend
    //      was already showing.
    // Footer chrome uses the same logic (transitions off so the variant swap
    // at finish() doesn't fade on top of the blend reveal).
    var chromeTransition = [
      "  transition: none !important;",
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
      // Newsletter button: only non-grayscale element in the navbar (blue
      // badge). Lifted above the spot so the difference blend doesn't turn
      // it yellow. Set `position: relative` so the z-index has a positioning
      // context — the Webflow `<a>` is `position: static` by default. Layout
      // is unaffected (no inset values applied).
      newsletterLiftSel + " {",
      "  position: relative !important;",
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
        // Logo-wrapper override: must beat the navbar embed's
        // (0,3,0)-specificity `transition: color 500ms ease` rule, so use
        // !important as well as the higher-specificity selector. We snap
        // here for the same reason as the chrome above — see comment near
        // chromeTransition.
        logoTransitionSel + " {",
        "  transition: none !important;",
        "}",
        "@media (prefers-reduced-motion: reduce) {",
        "  " + darkSel + ", " + cutSel + ", " + fadeSel + " {",
        "    filter: none !important;",
        "    transition: none !important;",
        "  }",
        "  " + navTransitionSel + ", " + footerTransitionSel + ", " + logoTransitionSel + " {",
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
    if (HB_DEBUG && typeof hbLog === "function") {
      hbLog("setNavbarBaseMode", hbSnap());
    }

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

  // ─── LOGO COLOUR GUARD ─────────────────────────────────────────────────────
  // Belt-and-braces: if anything ever sets inline `color` on the logo
  // wrapper while the trigger is NOT `is-open` (e.g. a stale resize-driven
  // run of the navbar embed that races with another state change), strip it
  // immediately. Doesn't fire under normal operation; harmless if it does.
  function installLogoColorGuard() {
    if (typeof MutationObserver !== "function") return;

    document.querySelectorAll(NAVBAR_CONFIG.wrapperSelector).forEach(
      function (wrapper) {
        var logo = wrapper.querySelector(".navbar_logo-wrapper");
        var trigger = wrapper.querySelector('[navbar-menu="trigger"]');
        if (!logo || !trigger) return;
        if (logo.__hbLogoGuardInstalled) return;
        logo.__hbLogoGuardInstalled = true;

        function isMenuOpen() { return trigger.classList.contains("is-open"); }

        var observer = new MutationObserver(function () {
          if (isMenuOpen()) return;
          if (logo.style && logo.style.color) {
            logo.style.removeProperty("color");
          }
        });
        observer.observe(logo, {
          attributes: true,
          attributeFilter: ["style"],
        });

        if (!isMenuOpen() && logo.style && logo.style.color) {
          logo.style.removeProperty("color");
        }
      }
    );
  }

  // ─── DEBUG OVERLAY (gated by ?hbdebug=1) ───────────────────────────────────
  // Mounts a small fixed panel in the top-right of the screen that shows
  // live state for both the navbar wrapper and the logo wrapper, plus the
  // computed `transition` string on each — so we can verify the script's
  // logo-transition override actually took effect, and see whether the
  // navbar background-color is moving in sync with the logo color.
  // Tap the overlay to copy its contents to the clipboard.
  function isHbDebugEnabled() {
    try {
      if (/[?&]hbdebug=1\b/.test((window.location && window.location.search) || "")) return true;
    } catch (_) {}
    try {
      if (window.localStorage && window.localStorage.getItem("hbdebug") === "1") return true;
    } catch (_) {}
    return false;
  }

  var HB_DEBUG = isHbDebugEnabled();
  var HB_T0 = (window.performance && performance.now) ? performance.now() : Date.now();
  var HB_LOG = [];
  var HB_OVERLAY_EL = null;

  function hbNow() {
    return Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - HB_T0);
  }

  function hbSnap() {
    var wrapper = document.querySelector(NAVBAR_CONFIG.wrapperSelector);
    if (!wrapper) return null;
    var logo = wrapper.querySelector(".navbar_logo-wrapper");
    var trigger = wrapper.querySelector('[navbar-menu="trigger"]');
    var wcs = window.getComputedStyle ? window.getComputedStyle(wrapper) : null;
    var lcs = logo && window.getComputedStyle ? window.getComputedStyle(logo) : null;
    return {
      reveal: document.documentElement.getAttribute(CONFIG.revealAttr) || "(unset)",
      variant: wrapper.getAttribute(NAVBAR_CONFIG.attr) || "(unset)",
      triggerOpen: trigger ? trigger.classList.contains("is-open") : "(no trigger)",
      vw: window.innerWidth,
      // Navbar wrapper itself
      wrapperBg: wcs ? wcs.backgroundColor : "?",
      wrapperColor: wcs ? wcs.color : "?",
      wrapperTransition: wcs ? wcs.transition : "?",
      // Logo wrapper (child)
      logoColor: lcs ? lcs.color : "?",
      logoOpacity: lcs ? lcs.opacity : "?",
      logoVisibility: lcs ? lcs.visibility : "?",
      logoTransition: lcs ? lcs.transition : "?",
      logoInline: logo ? (logo.getAttribute("style") || "") : "(no logo)",
    };
  }

  function hbLog(kind, info) {
    if (!HB_DEBUG) return;
    HB_LOG.push({ t: hbNow(), kind: kind, info: info });
    if (HB_LOG.length > 200) HB_LOG.shift();
    try { console.log("[hb-bn +" + HB_LOG[HB_LOG.length - 1].t + "ms]", kind, info); } catch (_) {}
    hbRender();
  }

  function hbEnsureOverlay() {
    if (!HB_DEBUG) return null;
    if (HB_OVERLAY_EL && document.body && document.body.contains(HB_OVERLAY_EL)) return HB_OVERLAY_EL;
    if (!document.body) return null;
    var el = document.createElement("div");
    el.id = "hb-bn-debug";
    el.setAttribute("style", [
      "position:fixed", "top:8px", "right:8px",
      "z-index:2147483647",
      "max-width:min(96vw,520px)", "max-height:70vh",
      "overflow:auto",
      "padding:8px 10px", "border-radius:8px",
      "background:rgba(0,0,0,0.85)", "color:#0f0",
      "font:11px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace",
      "white-space:pre-wrap",
      "box-shadow:0 4px 16px rgba(0,0,0,0.4)",
    ].join(";"));
    el.addEventListener("click", function () {
      try {
        if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(el.textContent);
          var n = document.createElement("div");
          n.textContent = "(copied)";
          n.style.color = "#9ff";
          el.appendChild(n);
          setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 1000);
        }
      } catch (_) {}
    });
    document.body.appendChild(el);
    HB_OVERLAY_EL = el;
    return el;
  }

  function hbRender() {
    if (!HB_DEBUG) return;
    var el = hbEnsureOverlay();
    if (!el) return;
    var s = hbSnap();
    var head = "[hb-bn build=" + HB_BUILD + "] tap to copy\n";
    if (s) {
      head +=
        "reveal=" + s.reveal + " | variant=" + s.variant +
        " | open=" + s.triggerOpen + " | vw=" + s.vw + "\n" +
        "WRAPPER bg=" + s.wrapperBg + " | color=" + s.wrapperColor + "\n" +
        "  trans=" + s.wrapperTransition + "\n" +
        "LOGO color=" + s.logoColor + " | op=" + s.logoOpacity + " | vis=" + s.logoVisibility + "\n" +
        "  trans=" + s.logoTransition + "\n" +
        "  inline=" + (s.logoInline || "(none)") + "\n";
    } else {
      head += "(no navbar wrapper found yet)\n";
    }
    var rows = HB_LOG.slice(-80).map(function (e) {
      return "+" + e.t + "ms " + e.kind +
        (e.info && typeof e.info === "object" ? " " + JSON.stringify(e.info) :
         e.info != null ? " " + e.info : "");
    }).join("\n");
    el.textContent = head + "\n--- last " + Math.min(HB_LOG.length, 80) + " events ---\n" + rows;
  }

  function installDebugInstrumentation() {
    if (!HB_DEBUG) return;
    if (typeof MutationObserver !== "function") return;

    var wrapper = document.querySelector(NAVBAR_CONFIG.wrapperSelector);
    if (!wrapper) return;
    var trigger = wrapper.querySelector('[navbar-menu="trigger"]');

    new MutationObserver(function (muts) {
      muts.forEach(function (m) { hbLog("wrapper." + m.attributeName, hbSnap()); });
    }).observe(wrapper, {
      attributes: true,
      attributeFilter: ["class", NAVBAR_CONFIG.attr, "style"],
    });

    if (trigger) {
      new MutationObserver(function (muts) {
        muts.forEach(function (m) { hbLog("trigger." + m.attributeName, hbSnap()); });
      }).observe(trigger, {
        attributes: true,
        attributeFilter: ["class", "aria-expanded"],
      });
    }

    new MutationObserver(function (muts) {
      muts.forEach(function (m) {
        if (m.attributeName === CONFIG.revealAttr) {
          hbLog("html.reveal", document.documentElement.getAttribute(CONFIG.revealAttr));
        }
      });
    }).observe(document.documentElement, {
      attributes: true,
      attributeFilter: [CONFIG.revealAttr],
    });

    // Sample fast (every 50ms for 2s = 40 samples) to capture the
    // transition window in detail, then taper to 200ms for context.
    var samples = 0;
    var fastInterval = setInterval(function () {
      samples++;
      hbLog("s", hbSnap());
      if (samples >= 40) {
        clearInterval(fastInterval);
        var slow = 0;
        var slowInterval = setInterval(function () {
          slow++;
          hbLog("S", hbSnap());
          if (slow >= 15) clearInterval(slowInterval);
        }, 200);
      }
    }, 50);

    hbLog("debug install", hbSnap());
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

    installLogoColorGuard();
    installDebugInstrumentation();

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
      // Snaps the navbar from dark to base by removing the variant class.
      // The injected `transition: none !important` rule (see chromeTransition
      // in injectInitStyles) keeps this change instantaneous — no smooth
      // colour fade — to avoid the gray-on-gray invisibility window any
      // monotonic transition between grayscale opposites must produce.
      setNavbarBaseMode();
    }

    function swapFooterOnce() {
      if (footerSwapped) return;
      footerSwapped = true;
      // Same as the navbar but in the inverse direction (light → dark
      // variant) — also snaps thanks to the same `transition: none` rule.
      setFooterDarkMode();
    }

    function finish() {
      if (swapped) return;
      swapped = true;

      // 1. Atomic mode swap — by now the white spot covers the viewport,
      //    so changing the body classes is invisible to the user (the
      //    transitioned image filters etc. are already showing as if light).
      //    The navbar and footer (lifted above the spot) are also swapped
      //    HERE rather than at the start of the spot expansion: this aligns
      //    the navbar/footer "snap" with the moment the spot finishes its
      //    expansion, so the user perceives a single coordinated reveal.
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

        // Note: the navbar/footer variant swaps DELIBERATELY do NOT happen
        // here. They are deferred to finish() so the snap is timed with
        // the spot reaching full coverage, not the start of the expansion.
        // (Earlier builds called swapNavbarOnce()/swapFooterOnce() here so
        // their colour transitions could run in parallel with the spot,
        // but transitioning grayscale opposites smoothly produces a brief
        // gray-on-gray invisibility window — see chromeTransition comment
        // in injectInitStyles.)

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

