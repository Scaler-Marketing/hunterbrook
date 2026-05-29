(() => {
  const bodyBlocks = Array.from(
    document.querySelectorAll(".article_body-wrapper > .article_rich-text")
  ).filter((el) => getComputedStyle(el).display !== "none");

  const notesRoot = document.querySelector(".article_foot-note-rich-text");
  if (!bodyBlocks.length || !notesRoot) return;

  const notes = Array.from(notesRoot.querySelectorAll("ol > li"));
  if (!notes.length) return;

  const noteMap = new Map(
    notes.map((li, index) => [
      String(index + 1),
      {
        html: li.innerHTML.trim(),
      },
    ])
  );

  const panel = document.createElement("div");
  panel.id = "hb-fn-inline-panel";
  panel.className = "hb-fn-inline";
  panel.hidden = true;
  panel.setAttribute("role", "note");

  let activeButton = null;
  let activeAnchor = null;
  let transformedCount = 0;

  function setExpanded(button, value) {
    if (button) {
      button.setAttribute("aria-expanded", value ? "true" : "false");
    }
  }

  function insertPanelAfter(anchor) {
    if (!anchor || !anchor.parentNode) return;
    anchor.parentNode.insertBefore(panel, anchor.nextSibling);
  }

  function closePanel() {
    setExpanded(activeButton, false);
    activeButton = null;
    activeAnchor = null;
    panel.hidden = true;
    panel.classList.remove("is-visible");
    panel.innerHTML = "";

    if (panel.parentNode) {
      panel.parentNode.removeChild(panel);
    }
  }

  function findAnchor(button) {
    return (
      button.closest("p, blockquote, li, h1, h2, h3, h4, h5, h6, figcaption") ||
      button.closest(".article_rich-text")
    );
  }

  function openPanel(button) {
    const noteNumber = button.dataset.fn;
    const note = noteMap.get(noteNumber);
    const anchor = findAnchor(button);

    if (!note || !anchor) return;

    if (activeButton && activeButton !== button) {
      setExpanded(activeButton, false);
    }

    activeButton = button;
    activeAnchor = anchor;

    panel.innerHTML = note.html;
    insertPanelAfter(anchor);
    panel.hidden = false;
    panel.classList.add("is-visible");
    setExpanded(button, true);
  }

  bodyBlocks.forEach((block) => {
    block.querySelectorAll("sup").forEach((sup) => {
      const noteNumber = (sup.textContent || "").trim().replace(/[^\d]/g, "");
      if (!noteMap.has(noteNumber)) return;

      const wrapper = document.createElement("span");
      wrapper.className = "hb-fn-ref";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "hb-fn-btn";
      button.dataset.fn = noteNumber;
      button.textContent = noteNumber;
      button.setAttribute("aria-controls", panel.id);
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", `Footnote ${noteNumber}`);

      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const sameButton = activeButton === button && panel.classList.contains("is-visible");

        if (sameButton) {
          closePanel();
          return;
        }

        openPanel(button);
      });

      wrapper.appendChild(button);
      sup.replaceWith(wrapper);
      transformedCount += 1;
    });
  });

  if (!transformedCount) return;

  document.documentElement.classList.add("hb-inline-footnotes-ready");

  document.addEventListener("click", (event) => {
    if (
      activeButton &&
      !event.target.closest(".hb-fn-ref") &&
      !panel.contains(event.target)
    ) {
      closePanel();
    }
  });

  window.addEventListener("resize", () => {
    if (activeButton && activeAnchor && panel.parentNode) {
      insertPanelAfter(activeAnchor);
    }
  });
})();
