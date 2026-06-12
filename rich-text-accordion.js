(function () {
  "use strict";

  var ATTR = "accordion-rich-text";
  var CONTENT_TRANSITION_MS = 350;
  var CONTENT_EASING = "ease-in-out";
  var CHEVRON_TRANSITION_MS = 350;
  var CHEVRON_EASING = "linear";

  var styleInjected = false;

  function sel(value) {
    return "[" + ATTR + '="' + value + '"]';
  }

  function applyContentTransition(panel) {
    if (!panel) return;
    panel.style.transition =
      "max-height " + CONTENT_TRANSITION_MS + "ms " + CONTENT_EASING;
  }

  function injectStyles() {
    if (styleInjected) return;
    styleInjected = true;

    var css =
      sel("content-wrapper") +
      "{overflow:hidden;max-height:0;transition:max-height " +
      CONTENT_TRANSITION_MS +
      "ms " +
      CONTENT_EASING +
      "}" +
      sel("item") +
      ".is-open " +
      sel("content-wrapper") +
      "{max-height:var(--accordion-rt-max-height,3000px)}" +
      sel("header-chevron") +
      "{transition:transform " +
      CHEVRON_TRANSITION_MS +
      "ms " +
      CHEVRON_EASING +
      ";transform-origin:center}" +
      sel("item") +
      ".is-open " +
      sel("header-chevron") +
      "{transform:rotate(180deg)}";

    var styleEl = document.createElement("style");
    styleEl.setAttribute("data-accordion-rich-text", "");
    styleEl.appendChild(document.createTextNode(css));
    document.head.appendChild(styleEl);
  }

  function parseSections(source) {
    var sections = [];
    var current = null;
    var pending = [];

    function flushPending() {
      if (!current || !pending.length) {
        pending = [];
        return;
      }
      current.nodes = current.nodes.concat(pending);
      pending = [];
    }

    Array.prototype.forEach.call(source.childNodes, function (node) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE && node.tagName === "H2") {
        if (current) {
          flushPending();
          sections.push(current);
        }
        current = {
          title: node.textContent.replace(/\s+/g, " ").trim(),
          nodes: [],
        };
        return;
      }

      if (current) {
        current.nodes.push(node);
      } else {
        pending.push(node);
      }
    });

    if (current) {
      flushPending();
      sections.push(current);
    }

    return sections;
  }

  function setContentHeight(item, height) {
    var panel = item.querySelector(sel("content-wrapper"));
    if (!panel) return;
    panel.style.setProperty("--accordion-rt-max-height", height + "px");
  }

  function measurePanel(item) {
    var panel = item.querySelector(sel("content-wrapper"));
    if (!panel) return 0;
    var prevMax = panel.style.maxHeight;
    panel.style.maxHeight = "none";
    var height = panel.scrollHeight;
    panel.style.maxHeight = prevMax;
    return height;
  }

  function collapseItem(item) {
    var header = item.querySelector(sel("header"));
    var panel = item.querySelector(sel("content-wrapper"));
    item.classList.remove("is-open");
    if (header) header.setAttribute("aria-expanded", "false");
    if (panel) {
      panel.setAttribute("aria-hidden", "true");
      applyContentTransition(panel);
      panel.style.maxHeight = "0";
    }
  }

  function expandItem(item) {
    var header = item.querySelector(sel("header"));
    var panel = item.querySelector(sel("content-wrapper"));
    var height = measurePanel(item);
    item.classList.add("is-open");
    if (header) header.setAttribute("aria-expanded", "true");
    if (panel) {
      applyContentTransition(panel);
      panel.setAttribute("aria-hidden", "false");
      setContentHeight(item, height);
      panel.style.maxHeight = "0";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          panel.style.maxHeight = height + "px";
        });
      });
    }
  }

  function bindAccordion(wrapper) {
    if (!wrapper || wrapper.dataset.accordionRichTextBound === "1") return;
    wrapper.dataset.accordionRichTextBound = "1";

    wrapper.addEventListener("click", function (event) {
      var header = event.target.closest(sel("header"));
      if (!header || !wrapper.contains(header)) return;

      event.preventDefault();

      var item = header.closest(sel("item"));
      if (!item) return;

      var isOpen = item.classList.contains("is-open");

      if (isOpen) {
        collapseItem(item);
        return;
      }

      wrapper.querySelectorAll(sel("item") + ".is-open").forEach(function (openItem) {
        if (openItem !== item) collapseItem(openItem);
      });

      expandItem(item);
    });

    window.addEventListener("resize", function () {
      wrapper.querySelectorAll(sel("item") + ".is-open").forEach(function (item) {
        var height = measurePanel(item);
        setContentHeight(item, height);
        var panel = item.querySelector(sel("content-wrapper"));
        if (panel) panel.style.maxHeight = height + "px";
      });
    });
  }

  function populateItem(item, section, index) {
    var headerText = item.querySelector(sel("header-text"));
    var richText = item.querySelector(sel("rich-text"));
    var header = item.querySelector(sel("header"));
    var panel = item.querySelector(sel("content-wrapper"));

    if (headerText) headerText.textContent = section.title;

    if (richText) {
      richText.innerHTML = "";
      section.nodes.forEach(function (node) {
        richText.appendChild(node.cloneNode(true));
      });
    }

    var uid = "accordion-rt-" + index + "-" + Math.random().toString(36).slice(2, 8);

    if (header) {
      header.id = uid + "-trigger";
      header.setAttribute("role", "button");
      header.setAttribute("aria-expanded", "false");
      if (panel) header.setAttribute("aria-controls", uid + "-panel");
    }

    if (panel) {
      panel.id = uid + "-panel";
      panel.setAttribute("aria-hidden", "true");
      if (header) panel.setAttribute("aria-labelledby", header.id);
      applyContentTransition(panel);
      panel.style.maxHeight = "0";
    }

    item.classList.remove("is-open");
  }

  function buildFromSource(source) {
    var item = source.closest(sel("item"));
    if (!item) return;

    var wrapper = item.closest(".accordion-rich-text_wrapper") || item.parentElement;
    if (!wrapper) return;

    var sections = parseSections(source);
    if (!sections.length) {
      source.remove();
      return;
    }

    var template = item.cloneNode(true);
    var sourceInTemplate = template.querySelector(sel("source"));
    if (sourceInTemplate) sourceInTemplate.remove();

    var fragment = document.createDocumentFragment();

    sections.forEach(function (section, index) {
      var clone = template.cloneNode(true);
      populateItem(clone, section, index);
      fragment.appendChild(clone);
    });

    item.remove();
    wrapper.appendChild(fragment);
    bindAccordion(wrapper);
  }

  function init() {
    injectStyles();

    var sources = document.querySelectorAll(sel("source"));
    if (!sources.length) return;

    Array.prototype.forEach.call(sources, buildFromSource);
  }

  init();
})();

