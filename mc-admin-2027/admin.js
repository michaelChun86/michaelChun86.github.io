/* =========================================================================
   Michael Chun — 관리자 대시보드 (방문자 수 / 유입 경로)

   숫자는 Cloudflare Worker(API_ENDPOINT)를 거쳐 GA4 에서 받아옵니다.
   브라우저가 GA4 를 직접 못 읽는 이유는 구글이 서비스 계정 키를 요구하는데
   그 키를 이 파일에 넣으면 소스를 여는 누구나 볼 수 있기 때문입니다.
   그래서 키는 Cloudflare 에 두고, 이 페이지는 완성된 숫자만 받습니다.
   (설정 절차는 _cloudflare-worker/README.md)

   Worker 가 응답하지 않거나 주소를 비워 두면 아래 SAMPLE 로 그리고
   화면 위에 빨간 배너로 "샘플입니다" 라고 알려줍니다.

   [비밀번호 바꾸는 법]
     1) 이 페이지를 https 로 열고 브라우저 콘솔(F12)에서:
          await AdminPIN.hash("새비밀번호")
     2) 출력된 긴 문자열을 아래 PIN_SHA256 에 붙여넣기
     ※ 평문 비밀번호는 이 파일 어디에도 적지 않습니다. 해시만 둡니다.

   [보안 한계 — 꼭 알아두세요]
     이 잠금은 "우연히 들어온 사람을 막는 자물쇠"이지 보안이 아닙니다.
     정적 사이트라 검사는 브라우저 안에서 일어나므로, 마음먹고 들여다보면
     우회할 수 있습니다. 주소를 모르면 못 들어오는 것이 사실상의 방어선이라
     robots.txt 에도 이 경로를 적지 않았습니다(적는 순간 "여기 관리자
     페이지가 있다"고 공개하는 셈이라 역효과입니다).
     노출되는 것은 집계된 숫자뿐이고 개인정보는 없습니다.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     설정
     --------------------------------------------------------------------- */

  /* 현재 비밀번호는 0406 입니다. 바꾸려면 위 [비밀번호 바꾸는 법] 참고. */
  var PIN_SHA256 = "a90ef855d6ad7ff0a716e37f45f300fe95613959d426b7e593793cec7a4caeec";

  /* 실데이터 프록시(Cloudflare Worker) 주소. 비워 두면 아래 SAMPLE 로 그린다. */
  var API_ENDPOINT = "https://michael-chun-ga4.chun4422.workers.dev/";

  /* 푸터에 표시할 GA4 측정 ID. analytics.js 에 넣은 값과 같게 적어두면
     어느 속성을 보고 있는지 헷갈리지 않는다. (표시용일 뿐 동작과 무관) */
  var MEASUREMENT_ID = "G-5Y2SYP49PL";

  var SESSION_KEY = "mc-admin-ok";

  /* ---------------------------------------------------------------------
     샘플 데이터 — 실데이터가 붙으면 쓰이지 않습니다.
     구조는 Worker 가 돌려줘야 할 JSON 모양과 정확히 같습니다.
     --------------------------------------------------------------------- */
  var SAMPLE = {
    todayUsers: 34,
    todayDeltaPct: 21,          // 어제 대비 %
    weekUsers: 186,
    weekDeltaPct: -6,           // 지난 7일 대비 %
    monthUsers: 742,
    monthDeltaPct: 14,          // 지난 30일 대비 %
    avgEngagementSec: 96,       // 초
    sources: [
      { name: "Direct",     sessions: 88 },
      { name: "Search",     sessions: 61 },
      { name: "ArtStation", sessions: 37 },
      { name: "LinkedIn",   sessions: 24 },
      { name: "Instagram",  sessions: 15 }
    ],
    countries: [
      { name: "대한민국", users: 96 },
      { name: "미국",     users: 41 },
      { name: "일본",     users: 18 },
      { name: "독일",     users: 12 },
      { name: "캐나다",   users: 9 }
    ],
    pages: [
      { name: "홈",          views: 312 },
      { name: "3D WORK",     views: 208 },
      { name: "2D WORK",     views: 174 },
      { name: "PROFILE",     views: 131 },
      { name: "DEAR FATHER", views: 66 }
    ]
  };

  /* 도넛/막대에 쓰는 색 — 본 사이트의 보라 → 청록 계열 */
  var PALETTE = ["#b98bff", "#5be8e8", "#ff6fd8", "#8a6ddb", "#4f9a9d"];

  /* ---------------------------------------------------------------------
     비밀번호 인증
     --------------------------------------------------------------------- */
  var lock = document.getElementById("lock");
  var dash = document.getElementById("dash");
  var form = document.getElementById("pinForm");
  var input = document.getElementById("pinInput");
  var err = document.getElementById("pinErr");

  async function sha256(text) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.prototype.map
      .call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); })
      .join("");
  }

  /* 콘솔에서 새 비밀번호의 해시를 뽑기 위한 도우미 */
  window.AdminPIN = { hash: sha256 };

  function unlock() {
    lock.hidden = true;
    dash.hidden = false;
    render();
  }

  function lockUp() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    location.reload();
  }

  /* 이전에 인증했으면 바로 통과 */
  try {
    if (localStorage.getItem(SESSION_KEY) === PIN_SHA256) unlock();
  } catch (e) {}

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    /* 실패해도 화면에 아무 일도 일어나지 않는 상황은 만들지 않는다.
       조용히 죽으면 사용자는 원인을 알 길이 없다. */
    try {
      /* crypto.subtle 은 보안 컨텍스트(https 또는 localhost)에서만 존재한다.
         file:// 로 열거나 http 로 접속하면 아예 없어서, 안내가 없으면
         버튼을 눌러도 아무 반응이 없는 것처럼 보인다. */
      if (!window.crypto || !crypto.subtle) {
        fail("이 페이지는 https 로 접속해야 로그인할 수 있습니다.");
        return;
      }

      /* 모바일 자판이 끝에 공백을 붙이는 일이 잦아 앞뒤 공백은 떼고 본다 */
      var got = await sha256(input.value.trim());
      if (got === PIN_SHA256) {
        try { localStorage.setItem(SESSION_KEY, PIN_SHA256); } catch (e2) {}
        err.hidden = true;
        unlock();
        return;
      }
      wrong();
    } catch (ex) {
      fail("로그인 처리 중 오류: " + ex.message);
    }
  });

  /* 비밀번호가 틀렸을 때: 아무 문구도 남기지 않고 흔들기만 한다.
     "틀렸다"는 말조차 알려주지 않겠다는 방침. 흔들림은 글자가 아니므로
     들여다보는 쪽에는 정보를 주지 않으면서, 오타를 낸 본인은 알아챌 수 있다.
     ※ 아래 fail() 은 고장(https 아님, 예외 발생) 전용으로 남겨둔다.
        그건 비밀번호 힌트가 아니라 "왜 안 되는지"라서, 지워버리면
        눌러도 아무 반응 없는 상태를 다시 만들게 된다. */
  function wrong() {
    err.hidden = true;          // 이전 오류 문구가 남아 있으면 지운다
    shake();
  }

  /* 고장났을 때: 이유를 보여준다 (비밀번호 오류에는 쓰지 않는다) */
  function fail(msg) {
    err.textContent = msg;
    err.hidden = false;
    shake();
  }

  /* 상자를 짧게 흔들고 입력을 비운다 */
  function shake() {
    var box = lock.querySelector(".lock-box");
    box.classList.remove("shake");
    void box.offsetWidth;            // 애니메이션 재시작을 위한 리플로우
    box.classList.add("shake");
    input.value = "";
    input.focus();
  }

  document.getElementById("logout").addEventListener("click", lockUp);
  document.getElementById("refresh").addEventListener("click", render);

  /* ---------------------------------------------------------------------
     데이터 가져오기 — 실데이터/샘플의 유일한 분기점
     --------------------------------------------------------------------- */
  async function loadMetrics() {
    if (!API_ENDPOINT) return { data: SAMPLE, live: false };
    try {
      var res = await fetch(API_ENDPOINT, { credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var body = await res.json();
      if (body.error) throw new Error(body.error);
      return { data: body, live: true };
    } catch (e) {
      return { data: SAMPLE, live: false, error: e.message };
    }
  }

  /* ---------------------------------------------------------------------
     그리기
     --------------------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  var num = function (n) { return Number(n || 0).toLocaleString("ko-KR"); };

  function mmss(sec) {
    var m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + "분 " + String(s).padStart(2, "0") + "초";
  }

  function delta(pct, label) {
    if (pct === 0 || pct == null) return "&nbsp;";
    var up = pct > 0;
    return '<span class="' + (up ? "up" : "down") + '">' +
           (up ? "▲" : "▼") + " " + Math.abs(pct) + "%</span> " + label;
  }

  /* 사용자가 넣은 문자열이 그대로 HTML 로 들어가지 않게 한다.
     페이지 제목·유입 소스는 GA4(=외부)에서 온 값이라 신뢰할 수 없다. */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 막대 목록 하나를 그린다. rows 의 값 필드 이름은 셋 중 아무거나 가능. */
  function drawBars(el, rows, unit) {
    var val = function (r) { return r.count != null ? r.count : (r.users != null ? r.users : r.views); };
    if (!rows || !rows.length) {
      el.innerHTML = '<li class="bar-num">데이터가 아직 없습니다.</li>';
      return;
    }
    var max = Math.max.apply(null, rows.map(val)) || 1;
    el.innerHTML = rows.map(function (r) {
      var v = val(r);
      return '<li>' +
        '<div class="bar-top"><span class="bar-name">' + esc(r.name) + '</span>' +
        '<span class="bar-num">' + num(v) + unit + '</span></div>' +
        '<div class="bar-track"><i class="bar-fill" data-w="' + (v / max * 100) + '"></i></div>' +
        '</li>';
    }).join("");

    /* 0 → 실제 폭으로 바뀌어야 transition 이 보인다. 예전에는 이걸
       requestAnimationFrame 안에서 했는데, 탭이 배경에 있거나 창이
       화면을 그리지 않는 상태면 rAF 가 아예 호출되지 않아 막대가
       영원히 0 인 채로 남았다. 강제 리플로우로 "0" 을 확정시킨 뒤
       바로 최종값을 넣으면, 보이든 안 보이든 값은 항상 맞고
       화면에 보일 때는 전환도 그대로 재생된다. */
    void el.offsetWidth;
    el.querySelectorAll(".bar-fill").forEach(function (f) {
      f.style.width = f.dataset.w + "%";
    });
  }

  /* 유입 경로: 도넛 + 표 */
  function drawSources(rows) {
    rows = rows || [];
    var total = rows.reduce(function (a, r) { return a + r.sessions; }, 0);
    $("donutTotal").textContent = num(total);
    /* 나눗셈에만 쓰는 값. 위 표시용 total 과 분리해야 데이터가 없을 때
       가운데 숫자가 0 이 아니라 1 로 보이는 일이 없다. */
    var denom = total || 1;

    var C = 2 * Math.PI * 52;        // r=52 원둘레
    var offset = 0;
    $("donutSegs").innerHTML = rows.map(function (r, i) {
      var frac = r.sessions / denom;
      /* 처음엔 길이 0 으로 그려 두고, 다음 프레임에 실제 길이를 넣어
         호가 자라나는 것처럼 보이게 한다. */
      var seg = '<circle class="donut-seg" cx="60" cy="60" r="52" ' +
                'stroke="' + PALETTE[i % PALETTE.length] + '" ' +
                'stroke-dasharray="0 ' + C + '" ' +
                'stroke-dashoffset="' + (-offset * C) + '" ' +
                'data-len="' + (frac * C) + '" data-gap="' + C + '"></circle>';
      offset += frac;
      return seg;
    }).join("");

    /* 막대와 같은 이유로 rAF 를 쓰지 않는다 (drawBars 주석 참고) */
    void $("donut").getBoundingClientRect().width;
    $("donutSegs").querySelectorAll(".donut-seg").forEach(function (s) {
      s.setAttribute("stroke-dasharray", s.dataset.len + " " + s.dataset.gap);
    });

    $("srcTable").querySelector("tbody").innerHTML = rows.map(function (r, i) {
      return '<tr>' +
        '<td><span class="c-name"><span class="swatch" style="background:' +
          PALETTE[i % PALETTE.length] + '"></span>' + esc(r.name) + '</span></td>' +
        '<td class="c-num">' + num(r.sessions) + '</td>' +
        '<td class="c-pct">' + Math.round(r.sessions / denom * 100) + '%</td>' +
        '</tr>';
    }).join("");
  }

  async function render() {
    var out = await loadMetrics();
    var d = out.data;

    /* 안내 배너 — 샘플일 때(빨강)와, 실데이터인데 아직 0 일 때(회색).
       후자를 따로 두는 이유: GA4 는 수집을 시작해도 누적 보고서에
       숫자가 들어오기까지 하루 이틀 걸린다. 그동안 0 만 보이면
       고장난 것으로 오해하기 쉽다. */
    var notice = $("notice");
    var empty = out.live && !d.todayUsers && !d.weekUsers && !d.monthUsers;

    notice.hidden = out.live && !empty;
    notice.classList.toggle("notice-info", empty);

    if (!out.live) {
      $("noticeHead").textContent = "샘플 데이터입니다.";
      $("noticeText").textContent = out.error
        ? "실데이터 서버에 연결하지 못해 샘플로 표시합니다 (" + out.error + ")."
        : "아직 실데이터 연결 전이라 화면 확인용 예시 숫자입니다. admin.js 의 API_ENDPOINT 를 채우면 실제 수치로 바뀝니다.";
    } else if (empty) {
      $("noticeHead").textContent = "연결은 정상입니다.";
      $("noticeText").textContent =
        "아직 집계된 방문자가 없습니다. GA4 는 수집을 시작한 뒤 누적 보고서에 " +
        "숫자가 반영되기까지 최대 24~48시간이 걸립니다. 지금 바로 확인하려면 " +
        "GA4 의 [보고서 > 실시간] 을 보세요.";
    }

    $("kpiToday").textContent = num(d.todayUsers);
    $("kpiTodayDelta").innerHTML = delta(d.todayDeltaPct, "어제 대비");
    $("kpiWeek").textContent = num(d.weekUsers);
    $("kpiWeekDelta").innerHTML = delta(d.weekDeltaPct, "지난 7일 대비");
    $("kpiMonth").textContent = num(d.monthUsers);
    $("kpiMonthDelta").innerHTML = delta(d.monthDeltaPct, "지난 30일 대비");
    $("kpiTime").textContent = mmss(d.avgEngagementSec);

    drawSources(d.sources);
    drawBars($("countryBars"), d.countries, "명");
    drawBars($("pageBars"), d.pages, "회");

    $("footId").textContent = MEASUREMENT_ID || "측정 ID 미설정";
    $("updated").textContent = new Date().toLocaleString("ko-KR", {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
    }) + " 기준";
  }
})();
