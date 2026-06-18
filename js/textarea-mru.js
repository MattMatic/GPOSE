/*!
 * textarea-mru.js
 * Most-recently-used history recall for <textarea> elements, backed by
 * localStorage, with a button-triggered dropdown overlay.
 *
 * Each attached textarea gets its own independent history list, keyed by
 * a storage key you choose (or auto-derived from the textarea's id).
 *
 * Usage:
 *   <script src="textarea-mru.js"></script>
 *   <script>
 *     var mru = TextareaMRU.attach(document.getElementById('myTextarea'), {
 *       trigger: document.getElementById('myTrigger'),
 *       storageKey: 'compose-box'   // optional; separates this textarea's history from others
 *     });
 *
 *     // Whenever your app considers an entry "submitted":
 *     mru.add(myTextarea.value);
 *
 *     // Or, from anywhere else in your code, without holding a reference:
 *     TextareaMRU.addTo('compose-box', someText);
 *   </script>
 *
 * No build step, no dependencies. Works as a plain <script> include
 * (exposes window.TextareaMRU) or as a CommonJS/AMD module.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.TextareaMRU = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_PREFIX = 'textarea_mru:';
  var DEFAULT_MAX_ITEMS = 20;

  // Registry of live instances, keyed by storageKey, so addTo() can reach
  // an already-attached instance and keep its in-memory state + any open
  // panel in sync, instead of only writing to localStorage blind.
  var registry = {};

  function safeParse(raw) {
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function loadFromStorage(storageKey) {
    try {
      var raw = window.localStorage.getItem(storageKey);
      return raw ? safeParse(raw) : [];
    } catch (e) {
      console.warn('TextareaMRU: localStorage unavailable, falling back to in-memory only', e);
      return [];
    }
  }

  function saveToStorage(storageKey, history) {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(history));
    } catch (e) {
      console.warn('TextareaMRU: failed to persist history for "' + storageKey + '"', e);
    }
  }

  function dedupeAndCap(history, value, maxItems) {
    var trimmed = (value || '').trim();
    if (!trimmed) return history;
    var next = history.filter(function (item) { return item !== trimmed; });
    next.unshift(trimmed);
    if (next.length > maxItems) next = next.slice(0, maxItems);
    return next;
  }

  function resolveStorageKey(textarea, opts) {
    if (opts && opts.storageKey) return DEFAULT_PREFIX + opts.storageKey;
    if (textarea && textarea.id) return DEFAULT_PREFIX + 'id:' + textarea.id;
    throw new Error(
      'TextareaMRU.attach: provide opts.storageKey, or give the textarea an id, ' +
      'so each textarea gets its own separate history.'
    );
  }

  /**
   * Attach MRU history behavior to a single textarea.
   *
   * @param {HTMLTextAreaElement} textarea
   * @param {Object} [opts]
   * @param {HTMLElement} [opts.trigger]   Button that opens/closes the dropdown.
   * @param {HTMLElement} [opts.panel]     Container to render the dropdown into.
   *                                       If omitted, one is created and positioned
   *                                       automatically next to the textarea.
   * @param {string}  [opts.storageKey]    Key distinguishing this textarea's history
   *                                       from others. Defaults to the textarea's id.
   * @param {number}  [opts.maxItems]      Max entries kept (default 20).
   * @param {boolean} [opts.shortcut]      Enable Ctrl/Cmd+ArrowUp to open (default true).
   * @returns {Object} instance API: add, clear, getHistory, open, close, toggle, destroy
   */
  function findFixedContainingBlock(node) {
    var el = node;
    while (el && el !== document.body && el.nodeType === 1) {
      var cs = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (cs) {
        var transform = cs.transform || cs.webkitTransform;
        var hasContainment =
          (transform && transform !== 'none') ||
          (cs.perspective && cs.perspective !== 'none') ||
          (cs.filter && cs.filter !== 'none') ||
          (cs.willChange && /transform|perspective|filter/.test(cs.willChange)) ||
          (cs.contain && /paint|layout|strict|content/.test(cs.contain));
        if (hasContainment) return el;
      }
      el = el.parentElement;
    }
    return null;
  }

  function attach(textarea, opts) {
    if (!textarea || textarea.tagName !== 'TEXTAREA') {
      throw new Error('TextareaMRU.attach: first argument must be a <textarea> element.');
    }
    opts = opts || {};
    var maxItems = opts.maxItems || DEFAULT_MAX_ITEMS;
    var storageKey = resolveStorageKey(textarea, opts);
    var enableShortcut = opts.shortcut !== false;

    var history = loadFromStorage(storageKey);
    var open = false;
    var activeIndex = -1;
    var ownsPanel = false;

    var trigger = opts.trigger || null;
    var panel = opts.panel || null;

    if (!panel) {
      ownsPanel = true;
      panel = document.createElement('div');
      panel.className = 'textarea-mru-panel';
      panel.setAttribute('role', 'listbox');
      panel.style.display = 'none';
      panel.style.zIndex = '1000';
      panel.style.minWidth = '220px';
      panel.style.maxHeight = '220px';
      panel.style.overflowY = 'auto';
      panel.style.background = '#fff';
      panel.style.border = '1px solid #ccc';
      panel.style.borderRadius = '6px';
      panel.style.boxShadow = '0 2px 8px rgba(0,0,0,0.15)';
      panel.style.fontFamily = (window.getComputedStyle ? window.getComputedStyle(textarea).fontFamily : '') || 'inherit';

      // If the textarea lives inside a native <dialog>, the dialog (once
      // shown via showModal()) is promoted to the browser's top layer.
      // Anything appended to document.body as a plain sibling renders
      // beneath that layer and is made inert (no paint, no pointer
      // events, excluded from the a11y tree) for as long as the modal is
      // open, so the panel must live inside the dialog instead.
      //
      // Once inside the dialog, though, `position: absolute` is still a
      // layout participant in the dialog's scrollable-overflow box: a
      // panel positioned near/below the dialog's bottom edge expands
      // that box and a scrollbar appears on the dialog itself, which
      // then intercepts clicks the outside-click handler treats as
      // "outside the panel" and closes it. `position: fixed` removes the
      // panel from flow and from scrollable-overflow calculation
      // entirely, while still rendering correctly above the dialog's
      // content since both are in the top layer. (If some ancestor sets
      // a transform/filter/etc. that would change the fixed-position
      // containing block, positionPanel() below detects that and
      // compensates rather than assuming pure viewport coordinates.)
      var hostDialog = typeof textarea.closest === 'function' ? textarea.closest('dialog') : null;
      panel.style.position = hostDialog ? 'fixed' : 'absolute';
      if (hostDialog) {
        hostDialog.appendChild(panel);
      } else {
        document.body.appendChild(panel);
      }
    }
    panel.setAttribute('aria-label', panel.getAttribute('aria-label') || 'Recent entries');

    function positionPanel() {
      if (!ownsPanel) return; // caller controls position of their own panel
      var rect = textarea.getBoundingClientRect();
      if (panel.style.position === 'fixed') {
        // position: fixed is viewport-relative UNLESS some ancestor sets
        // transform/perspective/filter/will-change, which makes that
        // ancestor the containing block instead. Detect that case so we
        // don't silently mis-position the panel.
        var containingAncestor = findFixedContainingBlock(panel.parentNode);
        if (containingAncestor) {
          var ancestorRect = containingAncestor.getBoundingClientRect();
          panel.style.left = (rect.left - ancestorRect.left) + 'px';
          panel.style.top = (rect.bottom - ancestorRect.top + 4) + 'px';
        } else {
          panel.style.left = rect.left + 'px';
          panel.style.top = (rect.bottom + 4) + 'px';
        }
        panel.style.width = rect.width + 'px';
      } else {
        panel.style.left = (window.scrollX + rect.left) + 'px';
        panel.style.top = (window.scrollY + rect.bottom + 4) + 'px';
        panel.style.width = rect.width + 'px';
      }
    }

    function render() {
      panel.innerHTML = '';
      if (history.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'textarea-mru-empty';
        empty.textContent = 'No history yet';
        empty.style.padding = '10px 12px';
        empty.style.fontSize = '13px';
        empty.style.color = '#888';
        panel.appendChild(empty);
        return;
      }
      history.forEach(function (item, i) {
        var row = document.createElement('div');
        row.className = 'textarea-mru-item' + (i === activeIndex ? ' active' : '');
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
        row.dataset.value = item;
        row.textContent = item.length > 120 ? item.slice(0, 120) + '\u2026' : item;
        row.style.padding = '8px 12px';
        row.style.fontSize = '13px';
        row.style.cursor = 'pointer';
        row.style.whiteSpace = 'nowrap';
        row.style.overflow = 'hidden';
        row.style.textOverflow = 'ellipsis';
        row.style.borderBottom = i === history.length - 1 ? 'none' : '1px solid #eee';
        if (i === activeIndex) {
          row.style.background = '#e8f0fe';
        }

        // Use pointerdown (falls back to mousedown) rather than click, and
        // read the value directly off the element being interacted with
        // rather than re-deriving it from a possibly-stale index. This is
        // the key fix for unreliable selection in Edge: click can fire
        // after focus/blur and DOM updates have already moved things, but
        // pointerdown/mousedown fire before that, and capturing the value
        // on the node itself avoids any race with re-rendering.
        var selectFromEvent = function (e) {
          e.preventDefault();
          e.stopPropagation();
          choose(row.dataset.value);
        };
        if (window.PointerEvent) {
          row.addEventListener('pointerdown', selectFromEvent);
        } else {
          row.addEventListener('mousedown', selectFromEvent);
        }

        row.addEventListener('mouseenter', function () {
          activeIndex = i;
          highlightOnly();
        });
        panel.appendChild(row);
      });
    }

    // Update only the active/inactive classes+styles without a full
    // innerHTML rebuild, so we never detach a node mid-interaction.
    function highlightOnly() {
      var rows = panel.querySelectorAll('.textarea-mru-item');
      rows.forEach(function (row, i) {
        var isActive = i === activeIndex;
        row.classList.toggle('active', isActive);
        row.style.background = isActive ? '#e8f0fe' : '';
        row.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
    }

    function openPanel() {
      history = loadFromStorage(storageKey); // pick up changes from addTo() elsewhere
      open = true;
      activeIndex = history.length ? 0 : -1;
      positionPanel();
      panel.style.display = 'block';
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      render();
    }

    function closePanel() {
      open = false;
      activeIndex = -1;
      panel.style.display = 'none';
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
      if (open) closePanel(); else openPanel();
    }

    function choose(value) {
      if (value === undefined || value === null) return;
      textarea.value = value;
      closePanel();
      // Re-focus explicitly and synchronously; some browsers (notably
      // older Edge/IE-derived focus handling) will not return focus to
      // the textarea reliably if it was lost during the pointer sequence.
      window.requestAnimationFrame(function () {
        textarea.focus();
        var len = textarea.value.length;
        try { textarea.setSelectionRange(len, len); } catch (e) {}
      });
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function add(value) {
      history = dedupeAndCap(history, value, maxItems);
      saveToStorage(storageKey, history);
      if (open) render();
    }

    function clear() {
      history = [];
      saveToStorage(storageKey, history);
      if (open) render();
    }

    function getHistory() {
      return history.slice();
    }

    // --- event wiring ---

    function onTriggerClick(e) {
      e.preventDefault();
      toggle();
      if (open) textarea.focus();
    }
    if (trigger) trigger.addEventListener('click', onTriggerClick);

    function onKeyDown(e) {
      var ctrlUp = (e.ctrlKey || e.metaKey) && e.key === 'ArrowUp';
      if (enableShortcut && ctrlUp) {
        e.preventDefault();
        openPanel();
        return;
      }
      if (!open) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          if (history.length) {
            activeIndex = Math.min(activeIndex + 1, history.length - 1);
            highlightOnly();
            scrollActiveIntoView();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (history.length) {
            activeIndex = Math.max(activeIndex - 1, 0);
            highlightOnly();
            scrollActiveIntoView();
          }
          break;
        case 'Enter':
          e.preventDefault();
          if (activeIndex >= 0 && history[activeIndex] !== undefined) {
            choose(history[activeIndex]);
          } else {
            closePanel();
          }
          break;
        case 'Escape':
          e.preventDefault();
          closePanel();
          break;
        case 'Tab':
          closePanel();
          break;
      }
    }
    textarea.addEventListener('keydown', onKeyDown);

    function scrollActiveIntoView() {
      var activeEl = panel.querySelector('.textarea-mru-item.active');
      if (activeEl && activeEl.scrollIntoView) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }

    function onOutsideDown(e) {
      if (!open) return;
      if (panel.contains(e.target) || e.target === trigger) return;
      closePanel();
    }
    document.addEventListener('pointerdown', onOutsideDown, true);
    document.addEventListener('mousedown', onOutsideDown, true);

    function onWindowChange() {
      if (open) positionPanel();
    }
    window.addEventListener('resize', onWindowChange);
    window.addEventListener('scroll', onWindowChange, true);

    function destroy() {
      if (trigger) trigger.removeEventListener('click', onTriggerClick);
      textarea.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutsideDown, true);
      document.removeEventListener('mousedown', onOutsideDown, true);
      window.removeEventListener('resize', onWindowChange);
      window.removeEventListener('scroll', onWindowChange, true);
      if (ownsPanel && panel.parentNode) panel.parentNode.removeChild(panel);
      delete registry[storageKey];
    }

    var instance = {
      add: add,
      clear: clear,
      getHistory: getHistory,
      open: openPanel,
      close: closePanel,
      toggle: toggle,
      destroy: destroy,
      storageKey: storageKey.replace(DEFAULT_PREFIX, '')
    };

    registry[storageKey] = instance;
    return instance;
  }

  /**
   * Add an entry to a textarea's history by storage key, without holding
   * a reference to the attach() instance. Useful when the save action
   * happens far from where the textarea was wired up.
   *
   * If an instance for that key is currently attached, its live state
   * (and any open panel) is updated too; otherwise this writes straight
   * to localStorage so it is picked up the next time that textarea's
   * panel is opened.
   *
   * @param {string} storageKey  Same key passed as opts.storageKey to attach().
   * @param {string} value
   * @param {number} [maxItems]  Defaults to 20; only relevant if no live
   *                              instance is currently attached for this key.
   */
  function addTo(storageKey, value, maxItems) {
    var fullKey = DEFAULT_PREFIX + storageKey;
    var instance = registry[fullKey];
    if (instance) {
      instance.add(value);
      return;
    }
    var history = loadFromStorage(fullKey);
    history = dedupeAndCap(history, value, maxItems || DEFAULT_MAX_ITEMS);
    saveToStorage(fullKey, history);
  }

  /**
   * Read a textarea's history by storage key without an attach() instance.
   * @param {string} storageKey
   * @returns {string[]}
   */
  function getHistoryFor(storageKey) {
    var fullKey = DEFAULT_PREFIX + storageKey;
    var instance = registry[fullKey];
    if (instance) return instance.getHistory();
    return loadFromStorage(fullKey);
  }

  /**
   * Clear a textarea's history by storage key without an attach() instance.
   * @param {string} storageKey
   */
  function clearHistoryFor(storageKey) {
    var fullKey = DEFAULT_PREFIX + storageKey;
    var instance = registry[fullKey];
    if (instance) {
      instance.clear();
      return;
    }
    saveToStorage(fullKey, []);
  }

  return {
    attach: attach,
    addTo: addTo,
    getHistoryFor: getHistoryFor,
    clearHistoryFor: clearHistoryFor
  };
}));
