/* =========================================================================
   Michael Chun 개인 홈페이지 — GA4 프록시 (Cloudflare Worker)

   하는 일:
     브라우저는 GA4 를 직접 못 읽습니다. 구글이 서비스 계정 키를 요구하는데,
     그 키를 웹페이지에 넣으면 누구나 볼 수 있기 때문입니다.
     그래서 이 Worker 가 중간에서 대신 일합니다.

       관리자 페이지  ──(그냥 요청)──▶  이 Worker  ──(키로 인증)──▶  GA4
                     ◀──(숫자 JSON)──             ◀──(원본 데이터)──

     키는 Cloudflare 에 secret 으로 보관되어 브라우저로 절대 나가지 않습니다.

   돌려주는 JSON 은 admin.js 의 SAMPLE 과 똑같은 모양입니다.
   그래서 admin.js 는 API_ENDPOINT 한 줄만 채우면 나머지는 그대로 동작합니다.

   ※ 달라게임즈용 Worker 와는 별개로 새로 하나 배포하세요.
     같은 Worker 를 재사용하면 속성 ID 가 하나뿐이라 두 사이트를
     동시에 볼 수 없습니다. 서비스 계정 키는 같은 것을 써도 됩니다
     (GA4 두 속성 모두에 뷰어로 초대만 해 두면 됩니다).

   설정값(Cloudflare 대시보드에서 등록):
     [변수]   GA4_PROPERTY_ID   GA4 속성 ID (숫자 9~10자리. G- 로 시작하는 측정 ID 가 아님!)
     [변수]   ALLOWED_ORIGIN    https://michaelchun86.github.io
     [시크릿] GA_SERVICE_ACCOUNT_JSON   서비스 계정 JSON 파일 내용 전체
              (또는 SA_CLIENT_EMAIL + SA_PRIVATE_KEY 두 개로 나눠서)
   ========================================================================= */

const GA4_API = "https://analyticsdata.googleapis.com/v1beta";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

/* 액세스 토큰은 1시간 유효하므로 받아두고 재사용한다.
   (매 요청마다 재발급하면 느리고 낭비다) */
let tokenCache = { value: null, expiresAt: 0 };

/* 결과도 5분간 재사용한다. 새로고침을 연타해도 GA4 를 계속 때리지 않게. */
let dataCache = { value: null, expiresAt: 0 };

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    // 브라우저의 사전 요청(preflight)
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    /* 진단: 주소 뒤에 ?debug=1 을 붙이면 어떤 설정값이 Worker 에 실제로
       도착했는지 이름만 보여준다. 값은 절대 내보내지 않는다. */
    if (new URL(request.url).searchParams.get("debug") === "1") {
      const names = ["GA_SERVICE_ACCOUNT_JSON", "SA_CLIENT_EMAIL", "SA_PRIVATE_KEY",
                     "GA_PROPERTY_ID", "GA4_PROPERTY_ID", "ALLOWED_ORIGIN"];
      const state = {};
      for (const n of names) {
        const v = env[n];
        state[n] = v ? ("설정됨 (" + String(v).length + "자)") : "없음";
      }
      return json({
        도착한_설정값: state,
        Worker에_보이는_전체_이름: Object.keys(env),
        안내: "전부 없음 이면 변수 저장 후 Deploy 를 누르지 않았거나, 다른 Worker 에 넣은 것입니다."
      }, origin, "debug");
    }

    try {
      const now = Date.now();
      if (dataCache.value && now < dataCache.expiresAt) {
        return json(dataCache.value, origin, "hit");
      }

      const token = await getAccessToken(env);
      const data = await buildMetrics(env, token);

      dataCache = { value: data, expiresAt: now + 5 * 60 * 1000 };
      return json(data, origin, "miss");
    } catch (err) {
      // 실패해도 관리자 페이지가 이유를 알 수 있게 메시지를 담아 보낸다
      return json({ error: String(err && err.message || err) }, origin, "error", 500);
    }
  }
};

/* ---------------------------------------------------------------------------
   응답 헬퍼
   --------------------------------------------------------------------------- */
function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function json(obj, origin, cacheState, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...cors(origin),
      "Content-Type": "application/json; charset=utf-8",
      "X-Cache": cacheState
    }
  });
}

/* ---------------------------------------------------------------------------
   구글 인증: 서비스 계정 키로 JWT 를 만들어 액세스 토큰과 교환한다
   --------------------------------------------------------------------------- */
/* 서비스 계정 정보를 어떤 방식으로 넣었든 읽어낸다.
   ① GA_SERVICE_ACCOUNT_JSON — 내려받은 JSON 파일 내용을 통째로 (권장, 실수가 적다)
   ② SA_CLIENT_EMAIL + SA_PRIVATE_KEY — 두 값을 따로
   둘 중 하나만 채워져 있으면 된다. */
function readServiceAccount(env) {
  if (env.GA_SERVICE_ACCOUNT_JSON) {
    let sa;
    try {
      sa = JSON.parse(env.GA_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      throw new Error("GA_SERVICE_ACCOUNT_JSON 이 올바른 JSON 이 아닙니다. 파일 내용을 통째로(중괄호 포함) 붙여넣었는지 확인하세요.");
    }
    if (!sa.client_email || !sa.private_key) {
      throw new Error("GA_SERVICE_ACCOUNT_JSON 에 client_email 또는 private_key 가 없습니다.");
    }
    return { email: sa.client_email, key: sa.private_key };
  }
  if (env.SA_CLIENT_EMAIL && env.SA_PRIVATE_KEY) {
    return { email: env.SA_CLIENT_EMAIL, key: env.SA_PRIVATE_KEY };
  }
  throw new Error(
    "서비스 계정 미설정. Worker 에 도착한 설정값 이름: [" + Object.keys(env).join(", ") + "] " +
    "— 목록이 비어 있으면 변수를 저장한 뒤 Deploy 를 누르지 않았거나, 다른 Worker 에 넣은 것입니다. " +
    "자세히 보려면 주소 뒤에 ?debug=1 을 붙여보세요."
  );
}

/* 속성 ID 도 이름이 다를 수 있어 둘 다 받는다 */
function readPropertyId(env) {
  const id = env.GA4_PROPERTY_ID || env.GA_PROPERTY_ID;
  if (!id) throw new Error("속성 ID 미설정: GA4_PROPERTY_ID (또는 GA_PROPERTY_ID) 를 넣어주세요.");
  if (!/^[0-9]+$/.test(String(id).trim())) {
    throw new Error("속성 ID 는 숫자여야 합니다. G- 로 시작하는 측정 ID 를 넣으신 것 같습니다: " + id);
  }
  return String(id).trim();
}

async function getAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache.value && now < tokenCache.expiresAt - 60) return tokenCache.value;

  const sa = readServiceAccount(env);

  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: sa.email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  };

  const signingInput = b64url(JSON.stringify(header)) + "." + b64url(JSON.stringify(claim));
  const key = await importPrivateKey(sa.key);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput)
  );
  const jwt = signingInput + "." + b64urlFromBytes(new Uint8Array(sigBuf));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  const body = await res.json();
  if (!res.ok) throw new Error("토큰 발급 실패: " + (body.error_description || body.error || res.status));

  tokenCache = { value: body.access_token, expiresAt: now + (body.expires_in || 3600) };
  return tokenCache.value;
}

/* PEM(-----BEGIN PRIVATE KEY-----) 을 Web Crypto 가 쓸 수 있는 형태로 변환 */
async function importPrivateKey(pem) {
  const clean = pem
    .replace(/\\n/g, "\n")            // 시크릿에 \n 이 글자로 들어간 경우 대비
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  return crypto.subtle.importKey(
    "pkcs8", bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
}

function b64url(str) {
  return b64urlFromBytes(new TextEncoder().encode(str));
}
function b64urlFromBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ---------------------------------------------------------------------------
   GA4 리포트 호출
   --------------------------------------------------------------------------- */
async function runReport(env, token, body) {
  const res = await fetch(
    `${GA4_API}/properties/${readPropertyId(env)}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );
  const out = await res.json();
  if (!res.ok) {
    throw new Error("GA4 오류: " + (out.error && out.error.message || res.status));
  }
  return out;
}

/* 리포트 결과에서 숫자 하나만 꺼낸다 (합계형 리포트용) */
function firstMetric(report, index = 0) {
  const row = report.rows && report.rows[0];
  if (!row) return 0;
  return Number(row.metricValues[index].value) || 0;
}

/* 리포트 결과를 [{key, value}] 목록으로 */
function toRows(report) {
  return (report.rows || []).map(r => ({
    key: r.dimensionValues[0].value,
    value: Number(r.metricValues[0].value) || 0
  }));
}

function pctChange(current, previous) {
  if (!previous) return null;
  return Math.round((current - previous) / previous * 100);
}

/* ---------------------------------------------------------------------------
   보기 좋은 이름으로 바꾸기
   --------------------------------------------------------------------------- */
const SOURCE_NAMES = {
  "(direct)": "Direct",
  "google": "Search",
  "bing": "Search",
  "duckduckgo": "Search",
  "naver.com": "네이버",
  "search.naver.com": "네이버",
  "daum.net": "다음",
  "artstation.com": "ArtStation",
  "www.artstation.com": "ArtStation",
  "linkedin.com": "LinkedIn",
  "www.linkedin.com": "LinkedIn",
  "lnkd.in": "LinkedIn",
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
  "youtube.com": "YouTube",
  "m.youtube.com": "YouTube",
  "t.co": "X/Twitter",
  "x.com": "X/Twitter",
  "twitter.com": "X/Twitter",
  "facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "reddit.com": "Reddit",
  "behance.net": "Behance",
  "github.com": "GitHub",
  "dallagames.com": "달라게임즈"
};

const COUNTRY_NAMES = {
  "South Korea": "대한민국",
  "United States": "미국",
  "China": "중국",
  "Japan": "일본",
  "Germany": "독일",
  "United Kingdom": "영국",
  "France": "프랑스",
  "Canada": "캐나다",
  "Taiwan": "대만",
  "Brazil": "브라질",
  "Russia": "러시아",
  "India": "인도",
  "Singapore": "싱가포르",
  "(not set)": "미확인"
};

/* 페이지 경로 → 사람이 읽는 이름.
   GitHub Pages 의 클린 URL 이라 폴더 경로로 들어온다.
   끝의 index.html 이나 쿼리스트링이 붙어 들어오는 경우도 있어 정규화한다. */
const PAGE_NAMES = {
  "/": "홈",
  "/resume": "PROFILE",
  "/dear-father": "DEAR FATHER",
  "/3d-art": "3D WORK",
  "/2d-art": "2D WORK"
};

function pageName(path) {
  let p = String(path).split("?")[0].split("#")[0];
  p = p.replace(/index\.html$/, "");
  if (p.length > 1) p = p.replace(/\/+$/, "");   // 끝 슬래시 제거 (단 "/" 는 유지)
  return PAGE_NAMES[p] || p;
}

/* ---------------------------------------------------------------------------
   관리자 페이지가 쓰는 모양으로 조립
   --------------------------------------------------------------------------- */
async function buildMetrics(env, token) {
  readPropertyId(env);   // 설정이 잘못됐으면 여기서 바로 알려준다

  const R = body => runReport(env, token, body);
  const users = { metrics: [{ name: "activeUsers" }] };

  const [today, yesterday, week, prevWeek, month, prevMonth, engage, sources, countries, pages] =
    await Promise.all([
      // 오늘 / 어제
      R({ dateRanges: [{ startDate: "today", endDate: "today" }], ...users }),
      R({ dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }], ...users }),

      // 최근 7일 / 그 이전 7일
      R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], ...users }),
      R({ dateRanges: [{ startDate: "14daysAgo", endDate: "8daysAgo" }], ...users }),

      // 최근 30일 / 그 이전 30일
      R({ dateRanges: [{ startDate: "30daysAgo", endDate: "today" }], ...users }),
      R({ dateRanges: [{ startDate: "60daysAgo", endDate: "31daysAgo" }], ...users }),

      // 평균 참여 시간 = 총 참여 시간 ÷ 순 방문자
      R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          metrics: [{ name: "userEngagementDuration" }, { name: "activeUsers" }] }),

      // 유입 경로 상위 5
      R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          dimensions: [{ name: "sessionSource" }],
          metrics: [{ name: "sessions" }],
          orderBys: [{ desc: true, metric: { metricName: "sessions" } }],
          limit: 5 }),

      // 국가 상위 5
      R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          dimensions: [{ name: "country" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ desc: true, metric: { metricName: "activeUsers" } }],
          limit: 5 }),

      // 많이 본 페이지 상위 6
      // (정규화 후 합쳐질 수 있으니 5개보다 넉넉히 받아 우리 쪽에서 자른다)
      R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          dimensions: [{ name: "pagePath" }],
          metrics: [{ name: "screenPageViews" }],
          orderBys: [{ desc: true, metric: { metricName: "screenPageViews" } }],
          limit: 20 })
    ]);

  const todayUsers = firstMetric(today);
  const weekUsers = firstMetric(week);
  const monthUsers = firstMetric(month);

  const engagementTotal = firstMetric(engage, 0);
  const engagementUsers = firstMetric(engage, 1);
  const avgEngagementSec = engagementUsers
    ? Math.round(engagementTotal / engagementUsers)
    : 0;

  /* /3d-art 와 /3d-art/ 처럼 같은 페이지가 갈라져 들어오므로
     정규화한 이름으로 합산한 뒤 상위 5개만 남긴다. */
  const pageTotals = new Map();
  for (const r of toRows(pages)) {
    const name = pageName(r.key);
    pageTotals.set(name, (pageTotals.get(name) || 0) + r.value);
  }
  const topPages = [...pageTotals.entries()]
    .map(([name, views]) => ({ name, views }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  return {
    todayUsers,
    todayDeltaPct: pctChange(todayUsers, firstMetric(yesterday)),
    weekUsers,
    weekDeltaPct: pctChange(weekUsers, firstMetric(prevWeek)),
    monthUsers,
    monthDeltaPct: pctChange(monthUsers, firstMetric(prevMonth)),
    avgEngagementSec,

    sources: toRows(sources).map(r => ({
      name: SOURCE_NAMES[r.key] || r.key,
      sessions: r.value
    })),

    countries: toRows(countries).map(r => ({
      name: COUNTRY_NAMES[r.key] || r.key,
      users: r.value
    })),

    pages: topPages
  };
}
