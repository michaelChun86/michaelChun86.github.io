/* =========================================================================
   방문자 분석 (Google Analytics 4)

   ▼▼▼ 설정: 아래 MEASUREMENT_ID 한 줄만 채우면 됩니다 ▼▼▼
   비워 두면 이 파일은 아무 일도 하지 않습니다(사이트는 그대로 정상 동작).

   [측정 ID 받는 법 — 3분]
     analytics.google.com → 관리(좌측 하단 톱니) → 만들기 → 속성
     → 속성 이름 "Michael Chun" → 만들기
     → 플랫폼 "웹" 선택 → 웹사이트 URL 에 https://michaelchun86.github.io 입력
     → 만들어진 "측정 ID" (G-XXXXXXXXXX) 를 아래에 붙여넣기

   ※ 달라게임즈 사이트와는 별개의 속성을 만드세요. 같은 ID 를 쓰면
     두 사이트의 방문자가 한 통계에 섞입니다.

   [GA4 가 자동으로 잡아주는 것 — 따로 코드가 필요 없음]
     · 방문자 수, 신규/재방문, 국가·기기·브라우저
     · 유입 경로: 검색(구글/네이버), SNS, 외부 링크, 직접 방문
     · 페이지별 조회수 (홈 / PROFILE / DEAR FATHER / 3D / 2D)
     · UTM 파라미터 (?utm_source=... 를 붙인 링크로 들어왔을 때)
     · 스크롤, 체류 시간 (향상된 측정)

   [이 파일이 추가로 보내는 것]
     · site_language   — 지금 보고 있는 언어(ko/en). 모든 이벤트에 함께 붙는다.
     · artwork_view    — 갤러리 썸네일을 눌러 작품을 크게 봤을 때 (파일명)
     · language_change — 국기 버튼으로 언어를 바꿨을 때 (from → to)
     · contact_click   — 푸터의 이메일 주소를 눌렀을 때

   [★ GA4 에서 한 번만 등록해야 하는 것 — 안 하면 두 항목이 비어 보입니다]
     관리 → 맞춤 정의 → 맞춤 측정기준 만들기 (범위는 둘 다 "이벤트")
       이름 site_language / 이벤트 매개변수 site_language
       이름 artwork       / 이벤트 매개변수 artwork
     등록한 시점부터 쌓입니다. 과거 데이터는 소급되지 않습니다.

   [내 방문을 집계에서 빼는 법 — 두 가지]

     ① 이 브라우저만 빼기 (기기·브라우저 단위)
        주소 뒤에 ?notrack=1 을 붙여 한 번만 접속하면 그 브라우저는
        이후 영구히 전송하지 않습니다. 해제는 ?notrack=0.
          https://michaelchun86.github.io/?notrack=1
        관리자 대시보드(mc-admin-2027) 맨 아래 체크박스로도 켜고 끌 수 있습니다.
        (같은 도메인이라 저장소를 공유합니다)

        · 검수용 PC·휴대폰마다 한 번씩 해 두면 됩니다.
        · 브라우저 저장소를 지우거나 시크릿창을 쓰면 다시 잡힙니다.

     ② 집·사무실 전체 빼기 (IP 단위, GA4 설정)
        GA4 → 관리 → 데이터 스트림 → 스트림 선택 → 태그 설정 구성
        → 내부 트래픽 정의 → 규칙 만들기 (내 IP 입력)
        그 다음 관리 → 데이터 설정 → 데이터 필터 → "내부 트래픽" 을
        [테스트] 에서 [사용] 으로 바꿔야 실제로 제외됩니다.
        · 공유기에 붙은 모든 기기가 한 번에 빠집니다.
        · 유동 IP 면 주소가 바뀔 때마다 규칙을 고쳐야 하고,
          휴대폰 LTE/5G 는 IP 가 달라 빠지지 않습니다.

     ①과 ②는 같이 써도 됩니다. ①이 기기 단위로 확실하고,
     ②는 새 브라우저를 깔아도 자동으로 걸러 줍니다.

   [로컬 테스트도 집계에서 제외]
     localhost / 127.0.0.1 / file:// 에서는 전송하지 않습니다.
     개발 중 새로고침이 실제 방문 통계에 섞이지 않게 하기 위함입니다.
   ========================================================================= */
(function () {
  "use strict";

  /* ▼ 여기에 측정 ID 를 넣으세요 (예: "G-ABC123XYZ4") */
  var MEASUREMENT_ID = "G-5Y2SYP49PL";

  /* 이 브라우저를 집계에서 뺄지 기억해 두는 자리.
     ※ 관리자 대시보드(mc-admin-2027/admin.js)가 같은 키를 읽고 쓴다.
       한쪽만 고치면 체크박스와 실제 동작이 어긋나므로 같이 고칠 것. */
  var OPTOUT_KEY = "mc-no-track";

  /* ---------- 전송할지 말지 판단 ---------- */
  var host = location.hostname;
  var isLocal =
    !host ||                       // file:// 로 연 경우
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^192\.168\./.test(host);      // 같은 공유기 안의 다른 기기로 테스트할 때

  /* ?notrack=1 로 한 번 들어오면 이 브라우저를 계속 제외한다(해제는 ?notrack=0).
     휴대폰처럼 콘솔을 열기 어려운 기기에서도 주소만으로 켜고 끌 수 있게 한 것. */
  try {
    var q = new URLSearchParams(location.search).get("notrack");
    if (q === "1" || q === "on") localStorage.setItem(OPTOUT_KEY, "1");
    else if (q === "0" || q === "off") localStorage.removeItem(OPTOUT_KEY);
  } catch (e) {}

  var optedOut = false;
  try { optedOut = localStorage.getItem(OPTOUT_KEY) === "1"; } catch (e) {}

  if (optedOut) {
    /* 제외된 본인만 보는 확인 문구. 일반 방문자에게는 찍히지 않는다. */
    if (window.console) console.info("[analytics] 이 브라우저는 집계에서 제외 중입니다 (해제: ?notrack=0)");
    return;
  }

  if (!MEASUREMENT_ID || isLocal) return;   // ID 미설정이거나 로컬이면 통째로 비활성

  /* ---------- 지금 보고 있는 언어 ----------
     이 파일은 i18n.js 보다 먼저 실행이 끝난다. i18n 은 DOMContentLoaded 에서
     <html lang> 을 고치는데, 그때는 이미 첫 page_view 가 나간 뒤다.
     그래서 첫 전송에 한해 i18n 과 같은 저장소를 직접 읽는다.
     ※ 아래 키와 기본값("en")은 i18n.js 의 STORE_KEY / initialLang 과 같아야
       한다. i18n.js 를 고치면 여기도 같이 고칠 것. */
  function storedLang() {
    try {
      var v = localStorage.getItem("chun-lang-v2");
      if (v === "ko" || v === "en") return v;
    } catch (e) {}
    return "en";
  }

  /* 첫 전송 이후에는 i18n 이 갱신해 둔 <html lang> 이 정답이다 */
  function lang() { return document.documentElement.lang || storedLang(); }

  /* ---------- GA4 기본 스니펫 ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());

  /* config 에 넘긴 값은 이후 모든 이벤트에 함께 실려 나간다.
     그래서 page_view 마다 어느 언어로 보고 있었는지가 남는다. */
  gtag("config", MEASUREMENT_ID, { site_language: storedLang() });

  var s = document.createElement("script");
  s.async = true;                  // 렌더링을 막지 않는다
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
  document.head.appendChild(s);

  /* ---------- 갤러리 작품 조회 ----------
     썸네일을 눌러 라이트박스를 연 것만 센다. 좌우 화살표로 넘긴 것은
     세지 않는다 — 500장을 훑고 지나가면 모든 작품이 1회씩 찍혀,
     "무엇이 눈길을 끄는가" 라는 정보가 오히려 묻히기 때문이다.
     썸네일 클릭은 "이걸 크게 보고 싶다"는 분명한 의사표시다.

     script.js 를 건드리지 않으려고 문서 전체에서 클릭을 한 번만 듣고,
     카드 안의 <img> 주소에서 파일명을 꺼낸다. 갤러리 코드가 바뀌어도
     .gallery-item 과 <img> 만 유지되면 계속 동작한다. */
  document.addEventListener("click", function (ev) {
    var card = ev.target.closest && ev.target.closest(".gallery-item");
    if (!card) return;
    var img = card.querySelector("img");
    if (!img) return;

    /* "/Image/3D ART/3D Gallery/3D__New_001.webp" → "3D__New_001"
       %20 같은 인코딩이 섞여 들어오므로 디코딩해서 보낸다. */
    var file = img.getAttribute("src") || "";
    var name = file.split("/").pop().replace(/\.[a-z0-9]+$/i, "");
    try { name = decodeURIComponent(name); } catch (e) {}
    if (!name) return;

    gtag("event", "artwork_view", {
      artwork: name,
      gallery: document.body.getAttribute("data-page") || "",
      language: lang()
    });
  });

  /* ---------- 언어 변경 ----------
     capture 단계로 듣는다. i18n.js 의 핸들러는 버튼 자신에 달려 있어
     bubble 단계보다 먼저 실행되고, 그 안에서 <html lang> 을 새 언어로
     바꿔 버린다. bubble 로 들으면 이미 바뀐 뒤라 from 과 to 가 늘 같아져
     이벤트가 하나도 안 나간다. capture 로 먼저 잡아야 바뀌기 전 값을 읽는다. */
  document.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest(".lang-btn");
    if (!b) return;
    var to = b.getAttribute("data-lang");
    if (!to || to === lang()) return;      // 같은 언어를 다시 누른 건 세지 않는다
    gtag("event", "language_change", { from: lang(), to: to });
  }, true);

  /* ---------- 연락처 클릭 ----------
     mailto: 링크는 메일 앱으로 넘어가며 페이지가 그대로 남으므로
     전송이 끊길 걱정은 없다. */
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest('a[href^="mailto:"]');
    if (!a) return;
    gtag("event", "contact_click", { language: lang() });
  });

})();
