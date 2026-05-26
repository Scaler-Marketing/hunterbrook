
  document.addEventListener("DOMContentLoaded", function () {
    var categoryLinks = Array.from(
      document.querySelectorAll('[category-article="link"]')
    );

    if (!categoryLinks.length) return;

    var monthMap = {
      jan: 0,
      january: 0,
      feb: 1,
      february: 1,
      mar: 2,
      march: 2,
      apr: 3,
      april: 3,
      may: 4,
      jun: 5,
      june: 5,
      jul: 6,
      july: 6,
      aug: 7,
      august: 7,
      sep: 8,
      sept: 8,
      september: 8,
      oct: 9,
      october: 9,
      nov: 10,
      november: 10,
      dec: 11,
      december: 11
    };

    function cleanText(value) {
      return (value || "").replace(/\s+/g, " ").trim();
    }

    function getText(el) {
      return el ? cleanText(el.textContent) : "";
    }

    function parsePublishedDate(dateText, timeText) {
      if (!dateText) return null;

      var normalizedDate = cleanText(dateText).replace(
        /(\d)(st|nd|rd|th)/gi,
        "$1"
      );
      var dateMatch = normalizedDate.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);

      if (!dateMatch) return null;

      var monthName = dateMatch[1].toLowerCase();
      var month = monthMap[monthName];
      var day = parseInt(dateMatch[2], 10);
      var year = parseInt(dateMatch[3], 10);

      if (month === undefined) return null;

      var hours = 0;
      var minutes = 0;

      if (timeText) {
        var normalizedTime = cleanText(timeText).toUpperCase();
        var timeMatch = normalizedTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);

        if (timeMatch) {
          hours = parseInt(timeMatch[1], 10);
          minutes = parseInt(timeMatch[2], 10);
          var meridiem = timeMatch[3];

          if (meridiem === "PM" && hours !== 12) hours += 12;
          if (meridiem === "AM" && hours === 12) hours = 0;
        }
      }

      return new Date(year, month, day, hours, minutes, 0, 0);
    }

    function getPeople(card, attrName) {
      var nodes = Array.from(
        card.querySelectorAll('[category-article="' + attrName + '"]')
      );

      var seen = {};
      var people = [];

      nodes.forEach(function (node) {
        var link = node.tagName === "A" ? node : node.querySelector("a");
        if (!link) return;

        var name = getText(link);
        var href = link.getAttribute("href") || "#";
        var key = name + "|" + href;

        if (!name || seen[key]) return;
        seen[key] = true;

        people.push({
          name: name,
          href: href
        });
      });

      return people;
    }

    function getArticleData(linkEl) {
      var card =
        linkEl.closest(".category-article_inner-wrapper") || linkEl.parentElement;

      if (!card) return null;

      var dateEl = card.querySelector('[category-article="published-date"]');
      var timeEl = card.querySelector('[category-article="published-time"]');
      var imageEl = card.querySelector('[category-article="main-image"]');

      return {
        card: card,
        item:
          card.closest(".category-article_item") ||
          card.closest(".w-dyn-item") ||
          card,
        timestamp: parsePublishedDate(getText(dateEl), getText(timeEl)),
        link: linkEl.getAttribute("href") || "#",
        title: getText(card.querySelector('[category-article="title"]')),
        publishedDate: getText(dateEl),
        publishedTime: getText(timeEl),
        summary: getText(card.querySelector('[category-article="summary"]')),
        authors: getPeople(card, "authors"),
        editors: getPeople(card, "editors"),
        image: imageEl
      };
    }

    function setFeaturedText(attrName, value) {
      document
        .querySelectorAll('[featured-article="' + attrName + '"]')
        .forEach(function (el) {
          el.textContent = value || "";
        });
    }

    function setFeaturedLink(href) {
      document
        .querySelectorAll('[featured-article="link"]')
        .forEach(function (el) {
          el.setAttribute("href", href || "#");
        });
    }

    function renderPeople(attrName, people) {
      var marker = document.querySelector('[featured-article="' + attrName + '"]');
      if (!marker || !marker.parentElement) return;

      var container = marker.parentElement;
      var className = marker.className || "featured-article_author";

      container.innerHTML = "";

      people.forEach(function (person, index) {
        if (index > 0) {
          container.appendChild(document.createTextNode(", "));
        }

        var a = document.createElement("a");
        a.setAttribute("featured-article", attrName);
        a.setAttribute("href", person.href || "#");
        a.className = className;
        a.textContent = person.name;

        container.appendChild(a);
      });
    }

    function setFeaturedImage(sourceImage) {
      if (!sourceImage) return;

      var wrapper = document.querySelector(".featured-article_wrapper");
      var targets = Array.from(
        document.querySelectorAll('[featured-article="main-image"]')
      );

      if (wrapper) {
        wrapper.querySelectorAll(".featured-article_image").forEach(function (img) {
          if (targets.indexOf(img) === -1) {
            targets.push(img);
          }
        });
      }

      targets.forEach(function (img) {
        var src = sourceImage.getAttribute("src");
        var srcset = sourceImage.getAttribute("srcset");
        var sizes = sourceImage.getAttribute("sizes");
        var alt = sourceImage.getAttribute("alt") || "";

        if (src) img.setAttribute("src", src);
        if (srcset) img.setAttribute("srcset", srcset);
        else img.removeAttribute("srcset");
        if (sizes) img.setAttribute("sizes", sizes);
        else img.removeAttribute("sizes");

        img.setAttribute("alt", alt);
      });
    }

    var articles = categoryLinks
      .map(getArticleData)
      .filter(function (article) {
        return article && article.timestamp instanceof Date && !isNaN(article.timestamp);
      });

    if (!articles.length) return;

    var latestArticle = articles.reduce(function (latest, current) {
      return current.timestamp > latest.timestamp ? current : latest;
    });

    setFeaturedText("title", latestArticle.title);
    setFeaturedText("published-date", latestArticle.publishedDate);
    setFeaturedText("published-time", latestArticle.publishedTime);
    setFeaturedText("summary", latestArticle.summary);
    setFeaturedLink(latestArticle.link);
    renderPeople("authors", latestArticle.authors);
    renderPeople("editors", latestArticle.editors);
    setFeaturedImage(latestArticle.image);

    if (latestArticle.item) {
      latestArticle.item.remove();
    }
  });
