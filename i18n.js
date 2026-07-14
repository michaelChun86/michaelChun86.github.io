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
    "home.eyebrow": { ko: "작업 컬렉션" },
    "home.section.subtitle": { ko: "갤러리 둘러보기" },
    "hero.quote": { ko: "퀄리티는 결코 우연히 만들어지지 않는다.<br />언제나 성실한 고민과 노력 끝에 얻어지는 결과물이다." },
    "card.resume.desc": { en: "Bio and career information" },
    "card.father.desc": { en: "A page dedicated to my beloved father" },
    "card.3d.desc": { en: "Modeling, rendering, and other 3D work" },
    "card.2d.desc": { en: "Logos, concept art, and other 2D work" },

    /* ---- 내비게이션/페이지명은 한국어 모드에서도 항상 영문 그대로 둔다(번역 키 없음) ---- */

    /* ---- Resume(=Profile) 페이지: 원문이 영문이라 ko 번역만 정의한다 ---- */
    "resume.intro.p1": { ko: "안녕하세요, 저의 웹사이트를 방문해 주셔서 감사합니다." },
    "resume.intro.p2": { ko: '저는 대한민국 서울을 기반으로 활동하고 있는 <strong>Michael Chun</strong>(본명 천준영)입니다.' },
    "resume.intro.p3": {
      ko: '게임 업계에서 약 <strong>15년</strong> 동안 다양한 실무 경력을 쌓아왔으며, 현재는 로그라이크 디펜스 게임인 <strong>The Aeon Fall</strong>(이온폴)을 개발 중인 <strong><span style="white-space:nowrap">달라게임즈</span>의 대표(CEO)</strong>를 맡고 있습니다.'
    },
    "resume.intro.p4": { ko: "개발자로서, 아티스트로서, 그리고 이제는 사업가로서 끊임없이 성장하기 위해 노력하고 있습니다.<br />저에 대해 더 궁금한 점이 있으시다면 언제든 편하게 연락해 주세요." },
    "resume.intro.p5": { ko: "방문해 주셔서 다시 한번 감사드립니다 :)" },

    "resume.experience.title": { ko: "경력사항" },

    "resume.exp1.category": { ko: "스팀 PC" },
    "resume.exp1.title": { ko: '로그라이크 디펜스 <span>이온폴</span> – CEO' },
    "resume.exp1.company": { ko: "달라게임즈" },
    "resume.exp1.period": { ko: "2026년 2월 – 현재" },

    "resume.exp2.category": { ko: "메타버스 게임" },
    "resume.exp2.title": { ko: '메타버스 <span>쏘사이어티</span> – Art Director / Technical Artist' },
    "resume.exp2.company": { ko: "앤더스 인터렉티브" },
    "resume.exp2.period": { ko: "2022년 1월 – 2026년 1월" },

    "resume.exp3.category": { ko: "모바일 게임" },
    "resume.exp3.title": { ko: 'RPG <span>별이 되어라 3</span> – Technical Artist' },
    "resume.exp3.company": { ko: "플린트" },
    "resume.exp3.period": { ko: "2021년 8월 – 2021년 12월" },

    "resume.exp4.category": { ko: "모바일 게임" },
    "resume.exp4.title": { ko: 'RPG <span>서머너즈워 2</span> – Art Director' },
    "resume.exp4.company": { ko: "컴투스" },
    "resume.exp4.period": { ko: "2020년 8월 – 2021년 8월" },

    "resume.exp5.category": { ko: "스팀 PC & 모바일 게임" },
    "resume.exp5.title": { ko: '오토 배틀 <span>히어로즈 쇼다운</span> – Art Director' },
    "resume.exp5.company": { ko: "패스파인더8" },
    "resume.exp5.period": { ko: "2019년 8월 – 2020년 7월" },

    "resume.exp6.category": { ko: "콘솔 게임" },
    "resume.exp6.title": { ko: 'RPG <span>프로젝트 P4</span> – Technical Artist' },
    "resume.exp6.company": { ko: "엑스엘 게임즈" },
    "resume.exp6.period": { ko: "2019년 1월 – 2019년 7월" },

    "resume.exp7.category": { ko: "콘솔 게임" },
    "resume.exp7.title": { ko: '어드벤처 <span>리틀 데빌 인사이드</span> – Technical Artist' },
    "resume.exp7.company": { ko: "니오스트림 인터렉티브" },
    "resume.exp7.period": { ko: "2016년 7월 – 2018년 12월" },

    "resume.exp8.category": { ko: "모바일 게임" },
    "resume.exp8.title": { ko: 'MMO RPG <span>액시드</span> – Art Director / RTS <span>엘리멘탈 블레이드</span> – Art Director' },
    "resume.exp8.company": { ko: "디피게임즈 (=옐로에그)" },
    "resume.exp8.period": { ko: "2015년 8월 – 2016년 6월" },

    "resume.exp9.category": { ko: "모바일 게임" },
    "resume.exp9.title": { ko: 'RTS <span>유크레프트</span> – Art Director / 레이싱 <span>토글스</span> – Art Director' },
    "resume.exp9.company": { ko: "옐로에그 (=디피게임즈)" },
    "resume.exp9.period": { ko: "2014년 2월 – 2015년 8월" },

    "resume.exp10.category": { ko: "PC 게임" },
    "resume.exp10.title": { ko: 'FPS <span>아바</span> – 3D 환경 아티스트' },
    "resume.exp10.company": { ko: "레드덕" },
    "resume.exp10.period": { ko: "2011년 3월 – 2014년 1월" },

    "resume.exp11.category": { ko: "게임 엔진" },
    "resume.exp11.title": { ko: "CRY ENGINE3 서비스 지원 - 인턴" },
    "resume.exp11.company": { ko: "크라이텍 코리아" },
    "resume.exp11.period": { ko: "2010년 6월 – 2010년 12월" },

    "resume.location.title": { ko: "위치" },
    "resume.location.value": { ko: "대한민국 서울" },
    "resume.university.title": { ko: "학력" },
    "resume.university.value": { ko: "홍익대학교<br />게임 그래픽디자인 학과" },
    "resume.specialties.title": { ko: "전문 분야" },
    "resume.specialties.s0": { ko: "팀빌딩" },
    "resume.specialties.s1": { ko: "아트 디렉팅" },
    "resume.specialties.s2": { ko: "라이팅" },
    "resume.specialties.s3": { ko: "렌더링" },
    "resume.specialties.s4": { ko: "셰이더 세팅" },
    "resume.specialties.s5": { ko: "하드서페이스 모델링" },
    "resume.specialties.s6": { ko: "텍스처링" },
    "resume.award.title": { ko: "수상 경력" },
    "resume.award.value": { ko: '2013 Unearthly Challenge III - <strong>7th Place Champion</strong><br />(3D vehicle 부문) USA' },
    "resume.contact.title": { ko: "연락처" },
    "resume.contact.value": { ko: '이메일: <a href="mailto:chun4422@gmail.com">chun4422@gmail.com</a>' },

    /* ---- Dear Father 페이지 콜라보 크레딧 라벨 ---- */
    "father.credit.video": { ko: "3D & 영상" },
    "father.credit.graffiti": { ko: "그래피티 아트" }
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

    /* data-i18n-only="ko|en": 번역이 아니라 언어별로 완전히 다른 문단을
       통째로 보여주고/숨길 때 쓴다(Dear Father 작가의 글처럼 원문이
       언어마다 아예 다른 경우). */
    document.querySelectorAll("[data-i18n-only]").forEach(function (el) {
      el.style.display = (el.getAttribute("data-i18n-only") === lang) ? "" : "none";
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
