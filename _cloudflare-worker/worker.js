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
/* 유입 경로 이름 → 한글.
   GA4 의 sessionSource 는 도메인이나 짧은 코드로 온다(예: ig = 인스타그램 앱).
   목록에 없으면 원래 값을 그대로 보여준다 — 숨기는 것보다 낫다.

   "(not set)" 은 고장이 아니라, GA4 가 그 세션의 출처를 판별하지 못했을 때
   붙이는 기본 라벨이다. 집계 초기, 앱 내부 브라우저, 광고 차단/개인정보
   설정으로 리퍼러가 잘린 방문에서 생긴다. 소수 섞이는 것은 정상이다. */
const SOURCE_NAMES = {
  "(direct)": "직접 방문",
  "(not set)": "미확인",
  "(none)": "직접 방문",

  // 검색
  "google": "구글 검색",
  "bing": "Bing 검색",
  "yahoo": "야후 검색",
  "duckduckgo": "덕덕고",
  "naver": "네이버",
  "naver.com": "네이버",
  "search.naver.com": "네이버",
  "daum": "다음",
  "daum.net": "다음",
  "search.daum.net": "다음",
  "baidu": "바이두",
  "yandex": "얀덱스",

  // 포트폴리오·업계
  "artstation.com": "아트스테이션",
  "behance.net": "비핸스",
  "linkedin.com": "링크드인",
  "lnkd.in": "링크드인",
  "github.com": "깃허브",
  "dribbble.com": "드리블",
  "cgsociety.org": "CGSociety",
  "polycount.com": "폴리카운트",
  "80.lv": "80 Level",
  "notion.so": "노션",

  // 영상·커뮤니티
  "youtube.com": "유튜브",
  "twitch.tv": "트위치",
  "vimeo.com": "비메오",
  "reddit.com": "레딧",
  "out.reddit.com": "레딧",
  "discord.com": "디스코드",
  "discord.gg": "디스코드",

  // SNS
  "t.co": "X (트위터)",
  "x.com": "X (트위터)",
  "twitter.com": "X (트위터)",
  "ig": "인스타그램",
  "instagram.com": "인스타그램",
  "facebook.com": "페이스북",
  "threads.net": "스레드",
  "tiktok.com": "틱톡",
  "pinterest.com": "핀터레스트",

  // 게임
  "store.steampowered.com": "스팀",
  "steamcommunity.com": "스팀",
  "itch.io": "itch.io",
  "dallagames.com": "달라게임즈",

  // 국내
  "kakao.com": "카카오톡",
  "plus.kakao.com": "카카오톡",
  "band.us": "네이버 밴드",
  "blog.naver.com": "네이버 블로그",
  "cafe.naver.com": "네이버 카페",
  "dcinside.com": "디시인사이드",
  "ruliweb.com": "루리웹",
  "inven.co.kr": "인벤",
  "tistory.com": "티스토리",
  "brunch.co.kr": "브런치",
  "velog.io": "벨로그",
  "linkareer.com": "링커리어",
  "saramin.co.kr": "사람인",
  "jobkorea.co.kr": "잡코리아",
  "wanted.co.kr": "원티드"
};

/* www. / m. / l. 같은 접두어를 떼고 한 번 더 찾아본다.
   (GA4 는 m.youtube.com, l.instagram.com, lm.facebook.com 등을 따로 센다)
   점은 반드시 이스케이프한다 — \. 가 아니면 "mail.google.com" 이
   "m" + 임의의 한 글자로 잘려 엉뚱한 값이 된다. */
function sourceName(raw) {
  if (SOURCE_NAMES[raw]) return SOURCE_NAMES[raw];
  const bare = String(raw).toLowerCase().replace(/^(www|m|l|lm|out|ptb)\./, "");
  return SOURCE_NAMES[bare] || raw;
}

/* 국가는 영문 이름 대신 ISO 국가코드로 맞춘다.
   영문 표기는 흔들릴 수 있지만("United States" / "U.S.") 코드는 고정이다. */
const COUNTRY_NAMES = {
  KR: "대한민국", US: "미국", JP: "일본", CN: "중국", TW: "대만",
  HK: "홍콩", MO: "마카오", SG: "싱가포르", MY: "말레이시아", TH: "태국",
  VN: "베트남", ID: "인도네시아", PH: "필리핀", IN: "인도", PK: "파키스탄",
  BD: "방글라데시", NP: "네팔", MM: "미얀마", KH: "캄보디아", LA: "라오스",
  MN: "몽골", KZ: "카자흐스탄", UZ: "우즈베키스탄",

  GB: "영국", IE: "아일랜드", DE: "독일", FR: "프랑스", IT: "이탈리아",
  ES: "스페인", PT: "포르투갈", NL: "네덜란드", BE: "벨기에", LU: "룩셈부르크",
  CH: "스위스", AT: "오스트리아", SE: "스웨덴", NO: "노르웨이", DK: "덴마크",
  FI: "핀란드", IS: "아이슬란드", PL: "폴란드", CZ: "체코", SK: "슬로바키아",
  HU: "헝가리", RO: "루마니아", BG: "불가리아", GR: "그리스", HR: "크로아티아",
  RS: "세르비아", SI: "슬로베니아", UA: "우크라이나", RU: "러시아", BY: "벨라루스",
  LT: "리투아니아", LV: "라트비아", EE: "에스토니아", TR: "튀르키예", CY: "키프로스",

  CA: "캐나다", MX: "멕시코", BR: "브라질", AR: "아르헨티나", CL: "칠레",
  CO: "콜롬비아", PE: "페루", UY: "우루과이", VE: "베네수엘라", EC: "에콰도르",

  AU: "호주", NZ: "뉴질랜드",

  IL: "이스라엘", SA: "사우디아라비아", AE: "아랍에미리트", QA: "카타르",
  KW: "쿠웨이트", IR: "이란", IQ: "이라크", JO: "요르단", LB: "레바논",

  EG: "이집트", ZA: "남아프리카공화국", NG: "나이지리아", KE: "케냐",
  MA: "모로코", DZ: "알제리", TN: "튀니지", GH: "가나", ET: "에티오피아"
};

/* 코드가 목록에 없으면 GA4 가 준 영문 이름을 그대로 쓴다 */
function countryName(code, englishName) {
  if (COUNTRY_NAMES[code]) return COUNTRY_NAMES[code];
  if (!englishName || englishName === "(not set)") return "미확인";
  return englishName;
}

/* 이름이 같아진 줄을 하나로 합친다.
   m.youtube.com 과 youtube.com 이 둘 다 "유튜브"가 되므로, 합치지 않으면
   같은 이름이 두 줄로 나온다. 합친 뒤 큰 순서로 다시 정렬해 상위 N 개만 남긴다.
   ※ 그래서 GA4 에는 5개가 아니라 20개를 요청한다. 5개만 받아 오면 합치는
     과정에서 줄이 사라져 합계가 실제보다 작게 나온다. */
function mergeByName(rows, valueKey, top) {
  const sum = new Map();
  for (const r of rows) sum.set(r.name, (sum.get(r.name) || 0) + r[valueKey]);
  return [...sum.entries()]
    .map(([name, v]) => ({ name, [valueKey]: v }))
    .sort((a, b) => b[valueKey] - a[valueKey])
    .slice(0, top);
}

/* GA4 의 deviceCategory 는 이 셋만 온다 */
const DEVICE_NAMES = {
  mobile: "모바일",
  desktop: "PC",
  tablet: "태블릿"
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

  const [total, today, yesterday, week, prevWeek, month, prevMonth,
         engage, sources, countries, devices, pages] =
    await Promise.all([
      /* 총 누적 방문자.
         GA4 Data API 가 받아주는 가장 이른 날짜가 2015-08-14 라 그걸 시작으로 둔다.
         속성이 만들어지기 전 구간은 그냥 0 이므로 결과에 영향이 없고,
         "속성 생성일"을 코드에 박아둘 필요도 없다.
         합계가 아니라 중복 제거된 순 방문자다 — 같은 사람이 여러 날 와도 1 로 센다.
         그래서 "최근 30일" 보다 작아지는 일은 없다(같은 지표, 더 넓은 기간). */
      R({ dateRanges: [{ startDate: "2015-08-14", endDate: "today" }], ...users }),

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
          limit: 20 }),   // 한글 이름으로 합친 뒤 상위 5개를 고르므로 넉넉히 받는다

      // 국가 상위 5 — 국가코드(KR)와 영문 이름을 함께 받는다.
      // 코드로 한글 이름을 찾고, 목록에 없으면 영문 이름으로 넘어간다.
      R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
          dimensions: [{ name: "countryId" }, { name: "country" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ desc: true, metric: { metricName: "activeUsers" } }],
          limit: 20 }),

      // 기기 종류 — 모바일 / 데스크톱 / 태블릿
      R({ dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
          dimensions: [{ name: "deviceCategory" }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ desc: true, metric: { metricName: "activeUsers" } }] }),

      // 많이 본 페이지 — 최근이 아니라 전체 기간 누적.
      // (정규화 후 합쳐질 수 있으니 5개보다 넉넉히 받아 우리 쪽에서 자른다)
      R({ dateRanges: [{ startDate: "2015-08-14", endDate: "today" }],
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

  return {
    totalUsers: firstMetric(total),
    todayUsers,
    todayDeltaPct: pctChange(todayUsers, firstMetric(yesterday)),
    weekUsers,
    weekDeltaPct: pctChange(weekUsers, firstMetric(prevWeek)),
    monthUsers,
    monthDeltaPct: pctChange(monthUsers, firstMetric(prevMonth)),
    avgEngagementSec,

    /* 아래 셋 모두 "한글 이름으로 바꾼 뒤 합치고 상위 5개" 순서다.
       바꾸기 전에 자르면 합쳐질 줄을 미리 버리게 되어 합계가 틀어진다. */
    sources: mergeByName(
      toRows(sources).map(r => ({ name: sourceName(r.key), sessions: r.value })),
      "sessions", 5
    ),

    countries: mergeByName(
      (countries.rows || []).map(r => ({
        name: countryName(r.dimensionValues[0].value, r.dimensionValues[1].value),
        users: Number(r.metricValues[0].value) || 0
      })),
      "users", 5
    ),

    /* 기기는 항상 3줄이 보이도록 없는 건 0 으로 채운다.
       "모바일만 0" 같은 것도 정보이므로 줄을 지우지 않는다. */
    devices: Object.keys(DEVICE_NAMES).map(key => ({
      name: DEVICE_NAMES[key],
      key,
      users: (toRows(devices).find(r => r.key === key) || {}).value || 0
    })),

    /* /3d-art 와 /3d-art/ 처럼 같은 페이지가 갈라져 들어온다 */
    pages: mergeByName(
      toRows(pages).map(r => ({ name: pageName(r.key), views: r.value })),
      "views", 5
    )
  };
}
