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

   [이 파일이 추가로 보내는 것 — 둘 다 아주 가볍습니다]
     · language_change — 국기 버튼으로 언어를 바꿨을 때 (from → to)
     · contact_click   — 푸터의 이메일 주소를 눌렀을 때

   [로컬 테스트는 집계에서 제외]
     localhost / 127.0.0.1 / file:// 에서는 전송하지 않습니다.
     개발 중 새로고침이 실제 방문 통계에 섞이지 않게 하기 위함입니다.
   ========================================================================= */
(function () {
  "use strict";

  /* ▼ 여기에 측정 ID 를 넣으세요 (예: "G-ABC123XYZ4") */
  var MEASUREMENT_ID = "G-5Y2SYP49PL";

  /* ---------- 전송할지 말지 판단 ---------- */
  var host = location.hostname;
  var isLocal =
    !host ||                       // file:// 로 연 경우
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    /^192\.168\./.test(host);      // 같은 공유기 안의 다른 기기로 테스트할 때

  if (!MEASUREMENT_ID || isLocal) return;   // ID 미설정이거나 로컬이면 통째로 비활성

  /* ---------- GA4 기본 스니펫 ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  gtag("js", new Date());
  gtag("config", MEASUREMENT_ID);

  var s = document.createElement("script");
  s.async = true;                  // 렌더링을 막지 않는다
  s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
  document.head.appendChild(s);

  /* 현재 언어: i18n.js 가 언어를 바꿀 때 <html lang> 도 함께 갱신한다 */
  function lang() { return document.documentElement.lang || "en"; }

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
