/* =========================================================================
   마우스 커서 잔상(트레일) + 호버 커서 깜박임 스크립트
   — 달라게임즈 홈페이지 커서 시스템을 이식한 독립 모듈 —
   ① 잔상: 커서가 일정 거리 이상 움직일 때마다 지나온 자리에
      녹색 커서 이미지 잔상을 하나씩 남기고, CSS 애니메이션(ct-fade)으로
      잠깐 머물렀다가 서서히 사라지게 한다.
      - 미리 만들어 둔 잔상(pool)을 돌려쓰므로 DOM 생성 부하가 없다.
   ② 호버 깜박임: html 에 .cur-alt 클래스를 빠르게 토글해서
      클릭 가능한 요소 위의 커서가 Cursor_Hover1 ↔ Cursor_Hover2 로 깜박이게 한다.
   - 터치 기기(마우스 없음)와 모션 최소화 환경에서는 아예 동작하지 않는다.
   - 잔상 수명·불투명도는 cursor-trail.css 상단 변수(--ct-*)에서 조절.
   ========================================================================= */
(function () {
  "use strict";

  /* ---------- 조절 변수 ---------- */
  var TRAIL = {
    enabled: true,
    spacing: 26,   // 잔상 사이 간격(px): 이만큼 움직여야 다음 잔상을 남긴다.
                   // 값이 작을수록 잔상이 촘촘하고 길어 보인다.
    poolSize: 3    // 동시에 존재할 수 있는 잔상의 최대 개수(꼬리 길이 제한)
  };
  var BLINK = {
    enabled: true,
    interval: 130  // 호버 커서 Hover1↔Hover2 전환 간격(ms). 작을수록 빠르게 깜박임.
  };

  // 모션 최소화 선호 → 잔상·깜박임 모두 끔
  if (
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) return;
  // 정밀 포인터(마우스)가 없는 터치 기기 → 끔
  if (window.matchMedia && !window.matchMedia("(pointer: fine)").matches) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    /* ----- ② 호버 커서 깜박임: .cur-alt 를 빠르게 토글 ----- */
    if (BLINK.enabled) {
      window.setInterval(function () {
        document.documentElement.classList.toggle("cur-alt");
      }, BLINK.interval);
    }

    /* ----- ① 커서 잔상 ----- */
    if (!TRAIL.enabled) return;

    // 오버레이 컨테이너 + 잔상 풀 생성
    var layer = document.createElement("div");
    layer.className = "cursor-trail";
    layer.setAttribute("aria-hidden", "true");

    var pool = [];
    for (var i = 0; i < TRAIL.poolSize; i++) {
      var ghost = document.createElement("span");
      ghost.className = "ct-ghost";
      layer.appendChild(ghost);
      pool.push(ghost);
    }
    document.body.appendChild(layer);

    var idx = 0;          // 다음에 재사용할 잔상 번호(순환)
    var lastX = null, lastY = null;

    window.addEventListener("pointermove", function (e) {
      // 마우스만(펜/터치 제외)
      if (e.pointerType && e.pointerType !== "mouse") return;

      // 마지막 잔상에서 spacing 이상 움직였을 때만 새 잔상을 남긴다
      if (lastX !== null) {
        var dx = e.clientX - lastX;
        var dy = e.clientY - lastY;
        if (dx * dx + dy * dy < TRAIL.spacing * TRAIL.spacing) return;
      }
      lastX = e.clientX;
      lastY = e.clientY;

      // 풀에서 잔상 하나를 꺼내 커서 위치(좌상단=핫스팟)에 놓고 애니메이션 재시작
      var ghost = pool[idx];
      idx = (idx + 1) % pool.length;
      ghost.style.left = e.clientX + "px";
      ghost.style.top = e.clientY + "px";
      ghost.classList.remove("on");
      void ghost.offsetWidth;        // 리플로 강제 → 같은 애니메이션 재발동
      ghost.classList.add("on");
    }, { passive: true });
  }
})();
