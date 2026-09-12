/* =============================================================================
   COPY-LINK — "copy a shareable link to this section" button (shared by every example)
   =============================================================================
   Self-initializing, zero-config: drop <script type="module" src="examples-copy-link.js">
   onto any example page and it appends a small chain-link button inside every section
   <h2>. Click it to copy the full, deep-linked URL to that section to the clipboard —
   e.g. https://examples.web-treeview.keenmate.dev/examples-basic.html#bu01-simple-file-tree
   — ready to paste into a message. The button briefly flips to a check + "Copied!"
   on success. Styles live in examples-shared.css under `.copy-link*`.

   The section anchor id is the SAME slug the chapter-nav ("on this page") jump list
   uses, so both agree on every hash. The slug logic below is intentionally a mirror of
   examples-chapter-nav.js — keep the two in sync. Both are idempotent (they reuse an
   existing section/h2 id before slugging), so it doesn't matter which script runs
   first, and copy-link still works on single-section pages where chapter-nav renders
   nothing.

   Link origin: by default the current page URL (so on the deployed site the copied
   link is already the correct public URL). Set `window.EXAMPLES_CANONICAL_ORIGIN`
   (e.g. 'https://examples.web-treeview.keenmate.dev') to force production links
   even when browsing a local copy. */
(function () {
  'use strict';

  // ── anchor id (mirror of examples-chapter-nav.js — keep in sync) ─────────────
  // Ensure every section <h2> in `.container` has a stable id on its section wrapper,
  // reusing an existing id or slugging the (badge-stripped) heading text. Returns a
  // [{ h2, id }] list in document order.
  function collectSections() {
    var container = document.querySelector('.container') || document.body;
    var headings = Array.prototype.slice.call(container.querySelectorAll('h2'));
    var used = Object.create(null);

    return headings.map(function (h2, i) {
      var section = h2.closest('.card, .example-section') || h2.parentElement || h2;

      var clone = h2.cloneNode(true);
      Array.prototype.forEach.call(clone.querySelectorAll('.badge, .copy-link'), function (el) { el.remove(); });
      var label = (clone.textContent || '').replace(/\s+/g, ' ').trim() || ('Section ' + (i + 1));

      var id = section.id || h2.id;
      if (!id) {
        id = label.toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') || ('section-' + (i + 1));
        if (used[id]) { var n = 2; while (used[id + '-' + n]) n++; id = id + '-' + n; }
        section.id = id;
      }
      used[id] = true;
      return { h2: h2, id: id };
    });
  }

  // ── clipboard ────────────────────────────────────────────────────────────────
  // Async Clipboard API where available (needs a secure context), with a legacy
  // execCommand fallback for http:// or older browsers. Resolves true on success.
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  var LINK_ICON =
    '<svg class="copy-link__icon copy-link__icon--link" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<path d="M9 12a3 3 0 0 0 3 3h4a3 3 0 0 0 0-6h-2"></path>' +
    '<path d="M15 12a3 3 0 0 0-3-3H8a3 3 0 0 0 0 6h2"></path>' +
    '</svg>';
  var CHECK_ICON =
    '<svg class="copy-link__icon copy-link__icon--check" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
    '<polyline points="5 13 10 18 19 7"></polyline>' +
    '</svg>';

  // Strip any trailing hash from the base URL, then append '#id'. On the deployed
  // site `location.href` already carries the public origin/path, so the copied link
  // is share-ready; `EXAMPLES_CANONICAL_ORIGIN` overrides it for local browsing.
  function buildUrl(id) {
    var override = typeof window.EXAMPLES_CANONICAL_ORIGIN === 'string' && window.EXAMPLES_CANONICAL_ORIGIN
      ? window.EXAMPLES_CANONICAL_ORIGIN.replace(/\/$/, '') + location.pathname
      : location.href;
    return override.replace(/#.*$/, '') + '#' + id;
  }

  function makeButton(id) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-link';
    btn.setAttribute('aria-label', 'Copy link to this section');
    btn.setAttribute('title', 'Copy link to this section');
    btn.innerHTML = LINK_ICON + CHECK_ICON + '<span class="copy-link__label" aria-hidden="true">Copied!</span>';

    var revert = null;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      copyText(buildUrl(id)).then(function (ok) {
        btn.classList.toggle('is-copied', ok);
        btn.classList.toggle('is-failed', !ok);
        btn.setAttribute('title', ok ? 'Link copied!' : 'Press Ctrl/Cmd+C to copy');
        if (revert) clearTimeout(revert);
        revert = setTimeout(function () {
          btn.classList.remove('is-copied', 'is-failed');
          btn.setAttribute('title', 'Copy link to this section');
        }, 1600);
      });
    });
    return btn;
  }

  function init() {
    collectSections().forEach(function (s) {
      // Don't double-add if a previous init already ran (defensive; init runs once).
      if (s.h2.querySelector('.copy-link')) return;
      s.h2.appendChild(makeButton(s.id));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
