/* =========================================================================
   다국어(로컬라이제이션) — 한국어 / English
   - 메뉴(PC) / 헤더 바로 아래 고정 바(모바일)의 국기 버튼 클릭 시
     지정된 부분만 언어 전환.
   - 사이트 대부분이 이미 영문으로 작성되어 있어(내비게이션, 카드 제목,
     Resume/3D/2D Work 등), 실제로 번역이 필요한 한국어 텍스트만 번역
     대상으로 삼는다(홈 "PORTFOLIO CATEGORIES" 카드 설명 4개).
   - 선택 언어는 localStorage 에 저장되어 다음 방문/페이지 이동에도 유지된다.
   - data-i18n     : textContent 교체
     data-i18n-html: innerHTML 교체
   - 특정 언어(en)에 번역 키가 없는 요소는 페이지에 원래 쓰여 있던 원문(한국어)
     으로 되돌아간다. 그래서 언어를 오갔다가 돌아와도 어색하게 남지 않는다.
   ========================================================================= */
(function () {
  "use strict";

  var LANGS = ["ko", "en"];
  var STORE_KEY = "chun-lang";

  var T = {
    "card.resume.desc": { en: "Bio, career, skills, and contact information" },
    "card.father.desc": { en: "A tribute page dedicated to my beloved father" },
    "card.3d.desc": { en: "Modeling, rendering, and other 3D work" },
    "card.2d.desc": { en: "Logos, concept art, and other 2D work" }
  };

  var ORIG_TEXT = new WeakMap();
  var ORIG_HTML = new WeakMap();
  function captureOriginals() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      ORIG_TEXT.set(el, el.textContent);
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      ORIG_HTML.set(el, el.innerHTML);
    });
  }

  function apply(lang) {
    if (LANGS.indexOf(lang) === -1) lang = "ko";

    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var k = el.getAttribute("data-i18n");
      var val = (T[k] && T[k][lang] != null) ? T[k][lang] : ORIG_TEXT.get(el);
      el.textContent = val;
    });
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var k = el.getAttribute("data-i18n-html");
      var val = (T[k] && T[k][lang] != null) ? T[k][lang] : ORIG_HTML.get(el);
      el.innerHTML = val;
    });

    document.documentElement.setAttribute("lang", lang);

    document.querySelectorAll(".lang-btn").forEach(function (b) {
      var on = b.getAttribute("data-lang") === lang;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });

    try { localStorage.setItem(STORE_KEY, lang); } catch (e) {}
  }

  // 기본 언어는 한국어(사이트 원문). 사용자가 국기로 고른 언어가 있으면
  // 다음 방문/페이지 이동에도 그 언어를 유지한다.
  function initialLang() {
    var saved = null;
    try { saved = localStorage.getItem(STORE_KEY); } catch (e) {}
    if (saved && LANGS.indexOf(saved) !== -1) return saved;
    return "ko";
  }

  function init() {
    captureOriginals();
    document.querySelectorAll(".lang-btn").forEach(function (b) {
      b.addEventListener("click", function () { apply(b.getAttribute("data-lang")); });
    });
    apply(initialLang());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
