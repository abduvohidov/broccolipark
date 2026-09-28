/* =========================================================
   Broccoli Park — script.js (чистый JS, без зависимостей)
   ========================================================= */
(function () {
  'use strict';

  var LANGS = ['ru', 'en', 'uz'];
  var DEFAULT_LANG = 'ru';
  var STORAGE_KEY = 'bp-lang';
  var PREVIEW_COUNT = 8;
  var PHONE_BOOKING = '+998955011010';
  var TELEGRAM_URL = 'https://t.me/broccoli_uz';
  // Адрес обработчика заявок (server.js). На хостинге замените на URL своей функции.
  var BOOKING_ENDPOINT = '/api/booking';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  var state = { lang: DEFAULT_LANG, dict: {}, dicts: {} };

  /* ---------------- Утилиты ---------------- */
  function t(key, vars) {
    var s = state.dict[key];
    if (s == null) s = (state.dicts.ru && state.dicts.ru[key]) || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.replace('{' + k + '}', vars[k]); });
    return s;
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* приватный режим */ } }

  /** Форматирование цены: «55 000 сум» / «55,000 UZS» / «55 000 soʻm» */
  function formatPrice(n, lang) {
    lang = lang || state.lang;
    var digits = String(Math.round(n));
    if (lang === 'en') return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + ' UZS';
    var grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return grouped + ' ' + (lang === 'uz' ? 'soʻm' : 'сум');
  }
  function formatNumber(n, decimals, lang) {
    lang = lang || state.lang;
    var s = decimals ? n.toFixed(decimals) : String(Math.round(n));
    if (decimals) return s; // «5.0» во всех языках — как на Яндекс Картах
    return s.replace(/\B(?=(\d{3})+(?!\d))/g, lang === 'en' ? ',' : ' ');
  }

  /* ---------------- i18n ---------------- */
  function detectLang() {
    var fromUrl = new URLSearchParams(location.search).get('lang');
    if (fromUrl && LANGS.indexOf(fromUrl) > -1) return fromUrl;
    var saved = storageGet(STORAGE_KEY);
    if (saved && LANGS.indexOf(saved) > -1) return saved;
    var navLangs = navigator.languages || [navigator.language || ''];
    for (var i = 0; i < navLangs.length; i++) {
      var code = String(navLangs[i]).toLowerCase().slice(0, 2);
      if (LANGS.indexOf(code) > -1) return code;
    }
    return DEFAULT_LANG;
  }

  var bundlePromise = null;
  function loadBundle() {
    // Фолбэк для file:// — там fetch() не может читать локальные JSON
    if (window.I18N_BUNDLE) return Promise.resolve(window.I18N_BUNDLE);
    if (!bundlePromise) {
      bundlePromise = new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = 'i18n/bundle.js';
        s.onload = function () { resolve(window.I18N_BUNDLE || {}); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return bundlePromise;
  }
  function loadDict(lang) {
    if (state.dicts[lang]) return Promise.resolve(state.dicts[lang]);
    var viaFetch = location.protocol.indexOf('http') === 0
      ? fetch('i18n/' + lang + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      : Promise.reject(new Error('file protocol'));
    return viaFetch.catch(function () {
      return loadBundle().then(function (b) { if (!b[lang]) throw new Error('no dict ' + lang); return b[lang]; });
    }).then(function (d) { state.dicts[lang] = d; return d; });
  }

  function setMeta(selector, attr, value) { var el = $(selector); if (el) el.setAttribute(attr, value); }

  function applyI18n() {
    var lang = state.lang;
    document.documentElement.lang = lang;

    $$('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (state.dict[key] != null) el.textContent = state.dict[key];
    });
    $$('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var p = pair.split(':'); if (p.length < 2) return;
        var val = state.dict[p[1].trim()]; if (val != null) el.setAttribute(p[0].trim(), val);
      });
    });

    // SEO / мета
    document.title = t('meta.title');
    setMeta('meta[name="description"]', 'content', t('meta.description'));
    setMeta('meta[property="og:title"]', 'content', t('meta.title'));
    setMeta('meta[property="og:description"]', 'content', t('meta.description'));
    setMeta('meta[property="og:locale"]', 'content', t('meta.ogLocale'));
    setMeta('link[rel="canonical"]', 'href', 'https://broccolipark.uz/' + (lang === DEFAULT_LANG ? '' : '?lang=' + lang));

    // Цены и названия блюд, привязанные к меню
    $$('[data-price]').forEach(function (el) { el.textContent = formatPrice(+el.getAttribute('data-price')); });
    $$('[data-dish-name]').forEach(function (el) { var d = dishById(el.getAttribute('data-dish-name')); if (d) el.textContent = d.name[lang]; });
    $$('[data-dish-price]').forEach(function (el) { var d = dishById(el.getAttribute('data-dish-price')); if (d) el.textContent = formatPrice(d.price); });
    $$('img[data-dish]').forEach(function (el) { var d = dishById(el.getAttribute('data-dish')); if (d) el.alt = d.name[lang]; });
    $$('[data-count]').forEach(function (el) { if (el.dataset.done) el.textContent = formatNumber(+el.dataset.count, +(el.dataset.decimals || 0)); });

    // Язык карты
    var map = $('#map-frame');
    if (map) {
      var mapLang = { ru: 'ru_RU', en: 'en_US', uz: 'uz_UZ' }[lang];
      var src = map.getAttribute('src').replace(/lang=[a-z]{2}_[A-Z]{2}/, 'lang=' + mapLang);
      if (src !== map.getAttribute('src')) map.setAttribute('src', src);
    }

    $$('.lang__btn').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    var burger = $('.burger');
    if (burger) burger.setAttribute('aria-label', t(burger.getAttribute('aria-expanded') === 'true' ? 'header.menuClose' : 'header.menuOpen'));

    renderLunchSets();
    Menu.onLangChange();
    Slider.onLangChange();
  }

  function setLang(lang, opts) {
    if (LANGS.indexOf(lang) < 0) lang = DEFAULT_LANG;
    return loadDict(lang).then(function (dict) {
      state.lang = lang; state.dict = dict;
      if (!opts || !opts.silent) storageSet(STORAGE_KEY, lang);
      // Обновляем ?lang= в адресе (соответствует hreflang), не трогая якорь
      try {
        var url = new URL(location.href);
        if (lang === DEFAULT_LANG) url.searchParams.delete('lang'); else url.searchParams.set('lang', lang);
        history.replaceState(null, '', url.pathname + url.search + url.hash);
      } catch (e) { /* file:// в старых браузерах */ }
      applyI18n();
    }).catch(function (err) { console.warn('[i18n] не удалось загрузить словарь', lang, err); });
  }

  /* ---------------- Данные меню ---------------- */
  var ITEMS = window.MENU_ITEMS || [];
  var CATS = window.MENU_CATEGORIES || [];
  var GROUPS = window.MENU_GROUPS || {};
  var byId = {};
  ITEMS.forEach(function (it, i) { it._i = i; byId[it.id] = it; });
  function dishById(id) { return byId[id]; }
  function catById(id) { for (var i = 0; i < CATS.length; i++) if (CATS[i].id === id) return CATS[i]; return CATS[0]; }
  var ICONS = { coffee: 'i-coffee', salad: 'i-salad', soup: 'i-soup', chef: 'i-chef', utensils: 'i-utensils', pizza: 'i-pizza', flame: 'i-flame', sparkles: 'i-sparkles', baby: 'i-baby', cake: 'i-cake', wheat: 'i-wheat', cup: 'i-cup' };

  function renderLunchSets() {
    var list = $('#lunch-list'); if (!list) return;
    var sets = ITEMS.filter(function (it) { return it.group === 'lunch'; });
    list.innerHTML = sets.map(function (s) {
      var num = (s.name.ru.match(/№\s?(\d+)/) || [])[1] || '';
      return '<li><b aria-hidden="true">№' + num + '</b><span><span class="visually-hidden">' + escapeHtml(s.name[state.lang]) + ': </span>' + escapeHtml(s.desc[state.lang]) + '</span></li>';
    }).join('');
  }

  /* ---------------- Меню: табы, поиск, карточки ---------------- */
  var Menu = (function () {
    var tabsEl = $('#menu-tabs');
    var panel = $('#menu-panel');
    var moreBtn = $('#menu-more');
    var statusEl = $('#menu-status');
    var search = $('#menu-search');
    var clearBtn = $('.search__clear');
    var indicator = tabsEl ? $('.tabs__indicator', tabsEl) : null;
    var active = CATS.length ? CATS[0].id : null;
    var expanded = false;
    var query = '';
    var ready = false;

    function norm(s) {
      return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[ʻʼ‘’'`]/g, '').replace(/\s+/g, ' ').trim();
    }

    function buildTabs() {
      if (!tabsEl) return;
      CATS.forEach(function (c) {
        var count = ITEMS.filter(function (it) { return it.category === c.id; }).length;
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'tab'; b.id = 'tab-' + c.id;
        b.setAttribute('role', 'tab'); b.setAttribute('aria-controls', 'menu-panel');
        b.dataset.cat = c.id;
        b.innerHTML = '<svg class="ico" aria-hidden="true"><use href="#' + (ICONS[c.icon] || 'i-utensils') + '"/></svg><span class="tab__label"></span><span class="tab__count">' + count + '</span>';
        tabsEl.appendChild(b);
      });
      tabsEl.addEventListener('click', function (e) {
        var b = e.target.closest('.tab'); if (!b) return;
        select(b.dataset.cat, { focus: false });
      });
      tabsEl.addEventListener('keydown', function (e) {
        var tabs = $$('.tab', tabsEl);
        var i = tabs.indexOf(document.activeElement); if (i < 0) return;
        var n = null;
        if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
        else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
        else if (e.key === 'Home') n = 0;
        else if (e.key === 'End') n = tabs.length - 1;
        if (n !== null) { e.preventDefault(); select(tabs[n].dataset.cat, { focus: true }); }
      });
      window.addEventListener('resize', debounce(moveIndicator, 120));
    }

    function updateTabs() {
      $$('.tab', tabsEl).forEach(function (b) {
        var c = catById(b.dataset.cat);
        $('.tab__label', b).textContent = c.name[state.lang];
        var sel = b.dataset.cat === active;
        b.setAttribute('aria-selected', String(sel));
        b.tabIndex = sel ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', 'tab-' + active);
      tabsEl.classList.toggle('is-searching', !!query);
      moveIndicator();
    }

    function moveIndicator() {
      if (!indicator) return;
      var b = $('#tab-' + active); if (!b) return;
      indicator.style.width = b.offsetWidth + 'px';
      indicator.style.transform = 'translateX(' + b.offsetLeft + 'px)';
    }

    function scrollTabIntoView(b) {
      var left = b.offsetLeft - (tabsEl.clientWidth - b.offsetWidth) / 2;
      tabsEl.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function select(cat, opts) {
      opts = opts || {};
      if (query) { query = ''; search.value = ''; clearBtn.hidden = true; }
      var changed = cat !== active;
      active = cat; expanded = !!opts.expand;
      updateTabs();
      var b = $('#tab-' + cat);
      if (b) { scrollTabIntoView(b); if (opts.focus) b.focus(); }
      render(changed || opts.force);
    }

    function sortPreview(list) {
      return list.slice().sort(function (a, b) {
        var ai = a.image ? 0 : 1, bi = b.image ? 0 : 1; if (ai !== bi) return ai - bi;
        var ah = a.tags.indexOf('hit') > -1 ? 0 : 1, bh = b.tags.indexOf('hit') > -1 ? 0 : 1; if (ah !== bh) return ah - bh;
        return a._i - b._i;
      });
    }

    function highlight(text, q) {
      var safe = escapeHtml(text);
      if (!q) return safe;
      var nt = norm(text);
      var idx = nt.indexOf(q);
      // Подсветка только если нормализация не изменила длину строки (иначе индексы сбиваются)
      if (idx < 0 || nt.length !== text.length) return safe;
      return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
    }

    /** Фото блюда: для Wolt — адаптивные размеры (чёткие на Retina), для своих файлов — как есть */
    function imgTag(url, alt) {
      var attrs = ' alt="' + escapeHtml(alt) + '" loading="lazy" decoding="async" width="800" height="600"';
      if (url.indexOf('imageproxy.wolt.com') > -1) {
        var u = escapeHtml(url.split('?')[0]);
        return '<img src="' + u + '?w=800" srcset="' + u + '?w=480 480w, ' + u + '?w=800 800w, ' + u + '?w=1200 1200w"' +
          ' sizes="(min-width:1280px) 300px, (min-width:1024px) 31vw, (min-width:480px) 47vw, 116px"' + attrs + '>';
      }
      return '<img src="' + escapeHtml(url) + '"' + attrs + '>';
    }

    function card(it, i, q) {
      var lang = state.lang;
      var c = catById(it.category);
      var name = it.name[lang] || it.name.ru;
      var desc = it.desc[lang] || '';
      var tags = it.tags.map(function (tg) { return '<span class="tag tag--' + tg + '">' + escapeHtml(t('menu.tag.' + tg)) + '</span>'; }).join('');
      var media = it.image
        ? imgTag(it.image, name)
        : '';
      return '<article class="dish" style="--cat:' + c.color + ';--d:' + Math.min(i, 12) + '">' +
        '<div class="dish__media' + (it.image ? '' : ' no-img') + '">' +
          (tags ? '<div class="dish__tags">' + tags + '</div>' : '') + media +
          '<div class="dish__ph" aria-hidden="true"><svg class="ico"><use href="#' + (ICONS[c.icon] || 'i-utensils') + '"/></svg><span>' + escapeHtml(name) + '</span></div>' +
        '</div>' +
        '<div class="dish__body">' +
          '<h3 class="dish__name">' + highlight(name, q) + '</h3>' +
          (desc ? '<p class="dish__desc">' + highlight(desc, q) + '</p>' : '') +
          '<p class="dish__price">' + formatPrice(it.price) + '</p>' +
        '</div></article>';
    }

    function html() {
      var lang = state.lang;
      if (query) {
        var q = query;
        var found = ITEMS.filter(function (it) {
          return norm(it.name[lang]).indexOf(q) > -1 || norm(it.desc[lang]).indexOf(q) > -1 ||
                 norm(it.name.ru).indexOf(q) > -1 || norm(it.name.en).indexOf(q) > -1 || norm(it.name.uz).indexOf(q) > -1 ||
                 norm(it.desc.ru).indexOf(q) > -1;
        });
        statusEl.textContent = t('menu.found', { n: found.length });
        moreBtn.hidden = true;
        if (!found.length) return '<p class="menu__empty">' + escapeHtml(t('menu.empty')) + '</p>';
        return sortPreview(found).map(function (it, i) { return card(it, i, q); }).join('');
      }
      statusEl.textContent = '';
      var list = ITEMS.filter(function (it) { return it.category === active; });
      moreBtn.hidden = list.length <= PREVIEW_COUNT;
      moreBtn.textContent = expanded ? t('menu.showLess') : t('menu.showAll', { n: list.length });
      moreBtn.setAttribute('aria-expanded', String(expanded));
      if (!expanded) return sortPreview(list).slice(0, PREVIEW_COUNT).map(function (it, i) { return card(it, i); }).join('');
      // Полный список: группируем по подразделам (group)
      var groupsOrder = [];
      list.forEach(function (it) { if (groupsOrder.indexOf(it.group) < 0) groupsOrder.push(it.group); });
      var out = ''; var n = 0;
      groupsOrder.forEach(function (g) {
        if (groupsOrder.length > 1) out += '<h3 class="menu__group-title">' + escapeHtml((GROUPS[g] || {})[lang] || g) + '</h3>';
        list.filter(function (it) { return it.group === g; }).forEach(function (it) { out += card(it, n++); });
      });
      return out;
    }

    var swapTimer = null;
    function render(animate) {
      if (!panel) return;
      clearTimeout(swapTimer);
      if (animate && !reduceMotion && ready) {
        panel.classList.add('is-leaving');
        swapTimer = setTimeout(function () { panel.innerHTML = html(); panel.classList.remove('is-leaving'); }, 180);
      } else {
        panel.innerHTML = html();
      }
    }

    function init() {
      if (!panel || !CATS.length) return;
      buildTabs();
      moreBtn.addEventListener('click', function () {
        expanded = !expanded;
        render(false);
        if (!expanded) { var top = $('#menu').getBoundingClientRect().top + window.scrollY - 70; window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' }); }
      });
      var onSearch = debounce(function () {
        query = norm(search.value);
        clearBtn.hidden = !search.value;
        expanded = false;
        updateTabs();
        render(false);
      }, 120);
      search.addEventListener('input', onSearch);
      search.addEventListener('keydown', function (e) { if (e.key === 'Escape') { search.value = ''; onSearch(); } });
      clearBtn.addEventListener('click', function () { search.value = ''; search.focus(); query = ''; clearBtn.hidden = true; updateTabs(); render(false); });
    }

    function onLangChange() {
      if (!panel || !CATS.length) return;
      updateTabs();
      render(false);
      ready = true;
      requestAnimationFrame(moveIndicator);
    }

    return { init: init, select: select, onLangChange: onLangChange };
  })();

  function debounce(fn, ms) { var tm; return function () { var a = arguments, c = this; clearTimeout(tm); tm = setTimeout(function () { fn.apply(c, a); }, ms); }; }

  /* ---------------- Шапка, навигация, бургер ---------------- */
  function initHeader() {
    var header = $('#header');
    var toTop = $('.to-top');
    var bottomBar = $('.bottom-bar');
    var hero = $('.hero');
    var heroMedia = $('.hero__media');
    var ticking = false;

    function onScroll() {
      var y = window.scrollY || window.pageYOffset;
      header.classList.toggle('is-scrolled', y > 24);
      var heroH = hero ? hero.offsetHeight : 600;
      toTop.classList.toggle('is-visible', y > heroH * 0.9);
      bottomBar.classList.toggle('is-visible', y > 120);
      // Лёгкий параллакс фона hero
      if (!reduceMotion && heroMedia && y < heroH) heroMedia.style.transform = 'translate3d(0,' + (y * 0.28).toFixed(1) + 'px,0)';
      ticking = false;
    }
    window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
    onScroll();

    toTop.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      var logo = $('.header .logo'); if (logo) logo.focus({ preventScroll: true });
    });

    // Подсветка активного пункта навигации
    var links = $$('.nav__link');
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting && map[en.target.id]) {
            links.forEach(function (l) { l.classList.remove('is-active'); l.removeAttribute('aria-current'); });
            map[en.target.id].classList.add('is-active'); map[en.target.id].setAttribute('aria-current', 'true');
          }
        });
      }, { rootMargin: '-45% 0px -50% 0px' });
      Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) io.observe(s); });
    }

    // Бургер-меню
    var burger = $('.burger');
    var menu = $('#mobile-menu');
    function openMenu() {
      menu.hidden = false;
      document.body.classList.add('menu-open');
      burger.setAttribute('aria-expanded', 'true');
      burger.setAttribute('aria-label', t('header.menuClose'));
      requestAnimationFrame(function () { requestAnimationFrame(function () { menu.classList.add('is-open'); }); });
      setTimeout(function () { var f = $('a', menu); if (f) f.focus({ preventScroll: true }); }, 250);
    }
    function closeMenu(returnFocus) {
      menu.classList.remove('is-open');
      document.body.classList.remove('menu-open');
      burger.setAttribute('aria-expanded', 'false');
      burger.setAttribute('aria-label', t('header.menuOpen'));
      setTimeout(function () { if (!menu.classList.contains('is-open')) menu.hidden = true; }, reduceMotion ? 0 : 550);
      if (returnFocus) burger.focus();
    }
    burger.addEventListener('click', function () { burger.getAttribute('aria-expanded') === 'true' ? closeMenu(true) : openMenu(); });
    menu.addEventListener('click', function (e) { if (e.target.closest('a')) closeMenu(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || burger.getAttribute('aria-expanded') !== 'true') return;
      closeMenu(true);
    });
    // Простая «ловушка фокуса» внутри открытого меню (бургер + ссылки)
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab' || burger.getAttribute('aria-expanded') !== 'true') return;
      var items = [burger].concat($$('.lang__btn', header)).concat($$('a, button', menu));
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    window.addEventListener('resize', debounce(function () { if (window.innerWidth >= 1280 && burger.getAttribute('aria-expanded') === 'true') closeMenu(false); }, 150));
  }

  /* ---------------- Анимации появления и счётчики ---------------- */
  function initReveal() {
    var els = $$('.reveal');
    if (reduceMotion || !('IntersectionObserver' in window)) { els.forEach(function (el) { el.classList.add('is-visible'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  }

  function initCounters() {
    var els = $$('[data-count]');
    function run(el) {
      var target = +el.dataset.count, dec = +(el.dataset.decimals || 0);
      el.dataset.done = '1';
      if (reduceMotion) { el.textContent = formatNumber(target, dec); return; }
      var dur = 1600, start = null;
      function step(ts) {
        if (!start) start = ts;
        var p = Math.min((ts - start) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = formatNumber(target * eased, dec);
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    if (!('IntersectionObserver' in window)) { els.forEach(run); return; }
    els.forEach(function (el) { el.textContent = formatNumber(0, +(el.dataset.decimals || 0)); });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { run(en.target); io.unobserve(en.target); } });
    }, { threshold: 0.5 });
    els.forEach(function (el) { io.observe(el); });
  }

  function initMarquee() {
    var track = $('.marquee__track'); if (!track) return;
    var group = $('.marquee__group', track);
    // Дублируем группу: анимация сдвигает трек на -50% — получается бесшовно
    var clone = group.cloneNode(true);
    track.appendChild(clone);
    // Если группа уже экрана — добавляем ещё копий
    if (group.offsetWidth && group.offsetWidth < window.innerWidth) {
      track.appendChild(group.cloneNode(true)); track.appendChild(group.cloneNode(true));
    }
  }

  /* ---------------- Слайдер отзывов ---------------- */
  var Slider = (function () {
    var root = $('#reviews-slider');
    if (!root) return { init: function () {}, onLangChange: function () {} };
    var track = $('.slider__track', root);
    var slides = $$('.review', root);
    var dotsWrap = $('.slider__dots', root);
    var timer = null, paused = false, inView = false;

    function metrics() {
      var w = slides[0].getBoundingClientRect().width;
      var gap = parseFloat(getComputedStyle(track).columnGap) || 16;
      var perView = Math.max(1, Math.round((track.clientWidth + gap) / (w + gap)));
      return { step: w + gap, pages: Math.max(1, slides.length - perView + 1) };
    }
    function current() { var m = metrics(); return Math.min(m.pages - 1, Math.round(track.scrollLeft / m.step)); }
    function goTo(i) {
      var m = metrics();
      if (i < 0) i = m.pages - 1; if (i >= m.pages) i = 0;
      track.scrollTo({ left: i * m.step, behavior: reduceMotion ? 'auto' : 'smooth' });
    }
    function buildDots() {
      var m = metrics();
      dotsWrap.innerHTML = '';
      for (var i = 0; i < m.pages; i++) {
        var d = document.createElement('button');
        d.type = 'button'; d.className = 'slider__dot';
        d.setAttribute('aria-label', t('reviews.dot', { n: i + 1 }));
        d.dataset.i = i;
        dotsWrap.appendChild(d);
      }
      syncDots();
    }
    function syncDots() {
      var c = current();
      $$('.slider__dot', dotsWrap).forEach(function (d, i) { d.setAttribute('aria-current', String(i === c)); });
    }
    function start() {
      stop();
      if (reduceMotion) return;
      timer = setInterval(function () { if (!paused && inView && !document.hidden) goTo(current() + 1); }, 5500);
    }
    function stop() { clearInterval(timer); }
    function pauseFor(ms) { paused = true; clearTimeout(pauseFor.t); pauseFor.t = setTimeout(function () { paused = false; }, ms); }

    function init() {
      track.style.position = 'relative';
      buildDots();
      $('[data-slide="prev"]', root).addEventListener('click', function () { pauseFor(9000); goTo(current() - 1); });
      $('[data-slide="next"]', root).addEventListener('click', function () { pauseFor(9000); goTo(current() + 1); });
      dotsWrap.addEventListener('click', function (e) { var d = e.target.closest('.slider__dot'); if (d) { pauseFor(9000); goTo(+d.dataset.i); } });
      track.addEventListener('scroll', debounce(syncDots, 60), { passive: true });
      root.addEventListener('mouseenter', function () { paused = true; });
      root.addEventListener('mouseleave', function () { paused = false; });
      root.addEventListener('focusin', function () { paused = true; });
      root.addEventListener('focusout', function () { paused = false; });
      track.addEventListener('touchstart', function () { pauseFor(9000); }, { passive: true });
      track.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight') { e.preventDefault(); goTo(current() + 1); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current() - 1); }
      });
      window.addEventListener('resize', debounce(buildDots, 200));
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { inView = en[0].isIntersecting; }, { threshold: 0.3 }).observe(root);
      } else inView = true;
      start();
    }
    function onLangChange() { if (dotsWrap.children.length) buildDots(); }
    return { init: init, onLangChange: onLangChange };
  })();

  /* ---------------- Галерея + лайтбокс ---------------- */
  function initLightbox() {
    var box = $('#lightbox');
    var btns = $$('.gallery__btn');
    if (!box || !btns.length) return;
    var img = $('.lightbox__img', box), cap = $('.lightbox__caption', box);
    var idx = 0, lastFocus = null;

    function show(i, dir) {
      idx = (i + btns.length) % btns.length;
      var src = $('img', btns[idx]);
      var url = src.currentSrc || src.src;
      var apply = function () { img.src = url; img.alt = src.alt; cap.textContent = src.alt; img.classList.remove('is-switching'); };
      if (dir && !reduceMotion) { img.classList.add('is-switching'); setTimeout(apply, 180); } else apply();
    }
    function open(i) {
      lastFocus = document.activeElement;
      box.hidden = false; show(i);
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(function () { box.classList.add('is-open'); });
      $('.lightbox__close', box).focus();
    }
    function close() {
      box.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(function () { box.hidden = true; }, reduceMotion ? 0 : 300);
      if (lastFocus) lastFocus.focus();
    }
    btns.forEach(function (b, i) {
      b.setAttribute('aria-haspopup', 'dialog');
      b.addEventListener('click', function () { open(i); });
    });
    $('.lightbox__close', box).addEventListener('click', close);
    $('.lightbox__nav--prev', box).addEventListener('click', function () { show(idx - 1, -1); });
    $('.lightbox__nav--next', box).addEventListener('click', function () { show(idx + 1, 1); });
    box.addEventListener('click', function (e) { if (e.target === box) close(); });
    document.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(idx + 1, 1);
      else if (e.key === 'ArrowLeft') show(idx - 1, -1);
      else if (e.key === 'Tab') {
        var f = $$('button', box), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // Свайп
    var x0 = null, y0 = null;
    box.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(idx + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close();
      x0 = y0 = null;
    });
  }

  /* ---------------- Бронирование ---------------- */
  function initBooking() {
    var form = $('#booking-form'); if (!form) return;
    var phone = $('#f-phone'), date = $('#f-date'), time = $('#f-time'), guests = $('#f-guests'), name = $('#f-name'), comment = $('#f-comment');
    var modal = $('#booking-modal');
    var formError = $('#form-error');

    function todayISO() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); }
    date.min = todayISO();

    // Маска телефона: +998 __ ___ __ __
    function formatPhone(value) {
      var digits = value.replace(/\D/g, '');
      if (digits.indexOf('998') === 0) digits = digits.slice(3);
      digits = digits.slice(0, 9);
      var out = '+998';
      if (digits.length) out += ' ' + digits.slice(0, 2);
      if (digits.length > 2) out += ' ' + digits.slice(2, 5);
      if (digits.length > 5) out += ' ' + digits.slice(5, 7);
      if (digits.length > 7) out += ' ' + digits.slice(7, 9);
      return out;
    }
    phone.addEventListener('focus', function () { if (!phone.value) phone.value = '+998 '; });
    phone.addEventListener('blur', function () { if (phone.value.replace(/\D/g, '').length <= 3) phone.value = ''; });
    phone.addEventListener('input', function () {
      var atEnd = phone.selectionStart === phone.value.length;
      phone.value = formatPhone(phone.value);
      if (atEnd) phone.setSelectionRange(phone.value.length, phone.value.length);
    });

    // Кнопки +/- для количества гостей
    $$('.stepper__btn', form).forEach(function (b) {
      b.addEventListener('click', function () {
        var v = Math.min(50, Math.max(1, (parseInt(guests.value, 10) || 0) + +b.dataset.step));
        guests.value = v; validateField(guests);
      });
    });

    var validators = {
      name: function () { return name.value.trim().length >= 2 ? '' : t('booking.err.name'); },
      phone: function () { return /^\+998 \d{2} \d{3} \d{2} \d{2}$/.test(phone.value) ? '' : t('booking.err.phone'); },
      date: function () { return date.value && date.value >= todayISO() ? '' : t('booking.err.date'); },
      time: function () { return time.value && time.value >= '08:00' && time.value <= '22:00' ? '' : t('booking.err.time'); },
      guests: function () { var v = +guests.value; return v >= 1 && v <= 50 && Math.floor(v) === v ? '' : t('booking.err.guests'); }
    };
    function validateField(input) {
      var fn = validators[input.name]; if (!fn) return true;
      var msg = fn();
      var field = input.closest('.field');
      field.classList.toggle('is-invalid', !!msg);
      input.setAttribute('aria-invalid', String(!!msg));
      var err = $('#' + input.id + '-err'); if (err) err.textContent = msg;
      return !msg;
    }
    [name, phone, date, time, guests].forEach(function (inp) {
      inp.addEventListener('blur', function () { if (inp.value || inp.dataset.touched) { inp.dataset.touched = '1'; validateField(inp); } });
      inp.addEventListener('input', function () { if (inp.closest('.field').classList.contains('is-invalid')) validateField(inp); });
    });

    function buildMessage(data) {
      var zoneLabel = t('booking.' + data.zone);
      var dateStr = data.date.split('-').reverse().join('.');
      var lines = [
        t('booking.msg.head'),
        t('booking.name') + ': ' + data.name,
        t('booking.phone') + ': ' + data.phone,
        t('booking.date') + ': ' + dateStr + ', ' + data.time,
        t('booking.guests') + ': ' + data.guests,
        t('booking.zone') + ': ' + zoneLabel
      ];
      if (data.comment) lines.push(t('booking.comment') + ': ' + data.comment);
      return lines.join('\n');
    }
    function copy(text) {
      if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(function () { legacyCopy(text); });
      legacyCopy(text); return Promise.resolve();
    }
    function legacyCopy(text) {
      try {
        var ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
        ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch (e) { /* не критично: текст виден в модалке */ }
    }

    var lastFocus = null;
    function openModal(msg, mode) {
      lastFocus = document.activeElement;
      var sent = mode === 'sent';
      $('#booking-msg').textContent = msg;
      $('#booking-msg').hidden = sent;
      $('#booking-tg').hidden = sent;
      var title = $('#booking-modal-title'), text = $('#booking-modal-text');
      title.setAttribute('data-i18n', sent ? 'booking.sent.title' : 'booking.ok.title');
      text.setAttribute('data-i18n', sent ? 'booking.sent.text' : 'booking.ok.text');
      title.textContent = t(title.getAttribute('data-i18n'));
      text.textContent = t(text.getAttribute('data-i18n'));
      modal.hidden = false;
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(function () { modal.classList.add('is-open'); });
      ($('#booking-tg').hidden ? $('.modal__close', modal) : $('#booking-tg')).focus();
    }
    function closeModal() {
      modal.classList.remove('is-open');
      document.body.style.overflow = '';
      setTimeout(function () { modal.hidden = true; }, reduceMotion ? 0 : 300);
      if (lastFocus) lastFocus.focus();
    }
    $('.modal__close', modal).addEventListener('click', closeModal);
    modal.addEventListener('click', function (e) { if (e.target === modal) closeModal(); });
    document.addEventListener('keydown', function (e) {
      if (modal.hidden) return;
      if (e.key === 'Escape') closeModal();
      if (e.key === 'Tab') {
        var f = $$('a, button', modal), first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var inputs = [name, phone, date, time, guests];
      var ok = inputs.map(validateField).every(Boolean);
      if (!ok) {
        formError.textContent = t('booking.err.form');
        var firstBad = inputs.filter(function (i) { return i.getAttribute('aria-invalid') === 'true'; })[0];
        if (firstBad) firstBad.focus();
        return;
      }
      formError.textContent = '';
      var data = {
        name: name.value.trim(), phone: phone.value, date: date.value, time: time.value,
        guests: guests.value, zone: (form.querySelector('input[name="zone"]:checked') || {}).value || 'zone1',
        comment: comment.value.trim(), lang: state.lang
      };
      data.website = (form.querySelector('input[name="website"]') || {}).value || ''; // ловушка для спам-ботов
      var msg = buildMessage(data);
      var submitBtn = form.querySelector('button[type="submit"]');
      var submitLabel = submitBtn.querySelector('[data-i18n]');

      function fallback() {
        // Запасной путь: копируем текст заявки и предлагаем Telegram / звонок
        copy(msg).then(function () { openModal(msg, 'fallback'); });
      }
      if (location.protocol.indexOf('http') !== 0) { fallback(); return; }

      submitBtn.disabled = true;
      submitBtn.classList.add('is-loading');
      if (submitLabel) submitLabel.textContent = t('booking.sending');
      var ctrl = window.AbortController ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);

      // Отправка на сервер (server.js → Telegram-бот)
      fetch(BOOKING_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
        signal: ctrl ? ctrl.signal : undefined
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
      }).then(function (res) {
        if (res.body && res.body.ok) {
          openModal(msg, 'sent');
          form.reset(); guests.value = 2;
          $$('.field', form).forEach(function (f) { f.classList.remove('is-invalid'); });
        } else if (res.status === 429) {
          formError.textContent = t('booking.err.rate');
        } else {
          fallback();
        }
      }).catch(fallback).then(function () {
        clearTimeout(timer);
        submitBtn.disabled = false;
        submitBtn.classList.remove('is-loading');
        if (submitLabel) submitLabel.textContent = t('booking.submit');
      });
    });

    // Кнопка «Заказать банкет» — подставляем повод в комментарий
    $$('[data-banquet]').forEach(function (a) {
      a.addEventListener('click', function () {
        var word = t('evenings.3.title');
        if (comment.value.indexOf(word) < 0) comment.value = (word + '. ' + comment.value).trim();
        var z = form.querySelector('input[value="zone2"]'); if (z) z.checked = true;
        setTimeout(function () { name.focus({ preventScroll: true }); }, 600);
      });
    });
  }

  /* ---------------- Кнопки, переключающие таб меню ---------------- */
  function initTabLinks() {
    document.addEventListener('click', function (e) {
      var a = e.target.closest('[data-open-tab]'); if (!a) return;
      e.preventDefault();
      Menu.select(a.getAttribute('data-open-tab'), { force: true });
      var top = $('#menu').getBoundingClientRect().top + window.scrollY - 70;
      window.scrollTo({ top: top, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  /* ---------------- Старт ---------------- */
  function init() {
    document.documentElement.classList.remove('no-js');
    initMarquee();
    Menu.init();
    initHeader();
    initReveal();
    initCounters();
    initLightbox();
    initBooking();
    initTabLinks();

    $$('.lang__btn').forEach(function (b) { b.addEventListener('click', function () { setLang(b.dataset.lang); }); });

    var lang = detectLang();
    // Русский словарь нужен всегда как запасной источник строк
    loadDict('ru').catch(function () {}).then(function () {
      return setLang(lang, { silent: !storageGet(STORAGE_KEY) && !new URLSearchParams(location.search).get('lang') });
    }).then(function () {
      if (!state.dict['meta.title']) { state.dict = state.dicts.ru || {}; }
      Slider.init();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
