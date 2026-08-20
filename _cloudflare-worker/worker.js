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

/* 결과도 5분간 재사용한다. 새로고침을 연타해도 GA4 를 계속 때리지 않게.
   기간 필터(전체/7일/30일)마다 답이 다르므로 기간별로 따로 담아 둔다. */
const dataCache = new Map();   // range -> { value, expiresAt }

/* 관리자 페이지의 기간 필터가 보내는 값 → GA4 의 시작 날짜.
   "all" 은 GA4 Data API 가 받아주는 가장 이른 날짜를 쓴다. 속성이 생기기
   전 구간은 어차피 0 이라, 속성 생성일을 코드에 박아둘 필요가 없다. */
const RANGES = {
  all: "2015-08-14",
  "7d": "7daysAgo",
  "30d": "30daysAgo"
};

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
      /* 모르는 값이 오면 전체 기간으로 떨어뜨린다 (기본값과 같다) */
      let range = new URL(request.url).searchParams.get("range") || "all";
      if (!RANGES[range]) range = "all";

      const now = Date.now();
      const hit = dataCache.get(range);
      if (hit && now < hit.expiresAt) return json(hit.value, origin, "hit");

      const token = await getAccessToken(env);
      const data = await buildMetrics(env, token, range);

      dataCache.set(range, { value: data, expiresAt: now + 5 * 60 * 1000 });
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

/* 항목이 정해진 목록(기기·신규/재방문·언어)을 항상 같은 줄 수로 만든다.
   GA4 가 안 돌려준 항목은 0 으로 채운다 — 줄이 사라지면 "0 이라서 없는 것"과
   "집계가 안 되는 것"을 구분할 수 없다. */
function fixedRows(nameMap, rows, valueKey) {
  return Object.keys(nameMap).map(key => ({
    name: nameMap[key],
    key,
    [valueKey]: (rows.find(r => r.key === key) || {}).value || 0
  }));
}

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

/* GA4 의 deviceCategory 는 mobile / desktop / tablet 이 온다.
   태블릿은 이 사이트에서 거의 0 이라 줄만 차지해서 뺐다.
   (필요해지면 tablet: "태블릿" 한 줄만 추가하면 된다) */
const DEVICE_NAMES = {
  mobile: "모바일",
  desktop: "PC"
};

/* newVsReturning 은 GA4 기본 측정기준. 값을 못 정한 세션은 빈 문자열로 온다. */
const VISITOR_NAMES = {
  new: "신규",
  returning: "재방문"
};

/* analytics.js 가 보내는 site_language 값 */
const LANG_NAMES = {
  ko: "한국어",
  en: "English"
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
async function buildMetrics(env, token, range) {
  readPropertyId(env);   // 설정이 잘못됐으면 여기서 바로 알려준다

  const R = body => runReport(env, token, body);
  const users = { metrics: [{ name: "activeUsers" }] };

  /* 관리자 페이지의 기간 필터가 고른 구간. 아래 "패널" 쿼리들만 이걸 쓰고,
     상단 KPI(오늘/7일/30일/누적)는 뜻이 고정된 숫자라 영향을 받지 않는다. */
  const picked = [{ startDate: RANGES[range] || RANGES.all, endDate: "today" }];
  const ALL = [{ startDate: RANGES.all, endDate: "today" }];

  /* 맞춤 측정기준(site_language, artwork)은 GA4 에 등록해야 나온다.
     등록 전이면 이 쿼리만 실패하므로, 실패해도 나머지 화면은 그대로
     보이도록 빈 결과로 바꿔 삼킨다. */
  const soft = fn => () => fn().catch(() => ({ rows: [] }));

  /* 이벤트 이름 하나로 거르는 필터 (여러 곳에서 같은 모양을 쓴다) */
  const isEvent = name => ({
    filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: name } }
  });

  const tasks = [
    /* ---------- 상단 KPI (기간 고정) ---------- */

    /* 총 누적 방문자 — 합계가 아니라 중복 제거된 순 방문자다.
       같은 사람이 여러 날 와도 1 로 센다. 그래서 같은 지표에 더 넓은 기간인
       이 값이 "최근 30일" 보다 작아지는 일은 없다. */
    () => R({ dateRanges: ALL, ...users }),

    // 오늘 / 어제
    () => R({ dateRanges: [{ startDate: "today", endDate: "today" }], ...users }),
    () => R({ dateRanges: [{ startDate: "yesterday", endDate: "yesterday" }], ...users }),

    // 최근 7일 / 그 이전 7일
    () => R({ dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], ...users }),
    () => R({ dateRanges: [{ startDate: "14daysAgo", endDate: "8daysAgo" }], ...users }),

    // 최근 30일 / 그 이전 30일
    () => R({ dateRanges: [{ startDate: "30daysAgo", endDate: "today" }], ...users }),
    () => R({ dateRanges: [{ startDate: "60daysAgo", endDate: "31daysAgo" }], ...users }),

    // 평균 참여 시간 = 총 참여 시간 ÷ 순 방문자 (전체 기간)
    () => R({ dateRanges: ALL,
        metrics: [{ name: "userEngagementDuration" }, { name: "activeUsers" }] }),

    // 연락처(이메일) 클릭 — 이 사이트의 유일한 전환 지표
    () => R({ dateRanges: ALL,
        metrics: [{ name: "eventCount" }],
        dimensionFilter: isEvent("contact_click") }),

    /* 프로필 페이지 조회수. pagePath 는 /resume 과 /resume/ 로 갈라져 들어오므로
       "시작이 /resume" 으로 잡은 뒤 합산한다. */
    () => R({ dateRanges: ALL,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: "/resume" }
          }
        } }),

    /* ---------- 아래 패널 (기간 필터 적용) ---------- */

    // 유입 경로 — 한글 이름으로 합친 뒤 상위 5개를 고르므로 넉넉히 받는다
    () => R({ dateRanges: picked,
        dimensions: [{ name: "sessionSource" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ desc: true, metric: { metricName: "sessions" } }],
        limit: 20 }),

    // 국가 — 국가코드(KR)와 영문 이름을 함께 받는다.
    // 코드로 한글 이름을 찾고, 목록에 없으면 영문 이름으로 넘어간다.
    () => R({ dateRanges: picked,
        dimensions: [{ name: "countryId" }, { name: "country" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ desc: true, metric: { metricName: "activeUsers" } }],
        limit: 20 }),

    // 접속 기기 (모바일 / PC)
    () => R({ dateRanges: picked,
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "activeUsers" }],
        orderBys: [{ desc: true, metric: { metricName: "activeUsers" } }] }),

    // 신규 vs 재방문 — GA4 기본 제공 측정기준이라 등록이 필요 없다
    () => R({ dateRanges: picked,
        dimensions: [{ name: "newVsReturning" }],
        metrics: [{ name: "activeUsers" }] }),

    /* 언어 비율 — 우리가 심은 site_language 로 "실제로 어느 언어로 봤는가"를 센다.
       GA4 기본 language 는 브라우저 언어라, 기본값이 영어인 이 사이트에서는
       실제로 읽은 언어와 다르다. */
    soft(() => R({ dateRanges: picked,
        dimensions: [{ name: "customEvent:site_language" }],
        metrics: [{ name: "screenPageViews" }],
        dimensionFilter: isEvent("page_view") })),

    // 많이 본 페이지
    () => R({ dateRanges: picked,
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ desc: true, metric: { metricName: "screenPageViews" } }],
        limit: 20 }),

    // 인기 작품 — 썸네일을 눌러 크게 본 횟수
    soft(() => R({ dateRanges: picked,
        dimensions: [{ name: "customEvent:artwork" }],
        metrics: [{ name: "eventCount" }],
        dimensionFilter: isEvent("artwork_view"),
        orderBys: [{ desc: true, metric: { metricName: "eventCount" } }],
        limit: 5 }))
  ];

  const [total, today, yesterday, week, prevWeek, month, prevMonth,
         engage, contact, profile,
         sources, countries, devices, visitorType, languages, pages, artworks] =
    await runInChunks(tasks, 8);

  const todayUsers = firstMetric(today);
  const weekUsers = firstMetric(week);
  const monthUsers = firstMetric(month);

  const engagementTotal = firstMetric(engage, 0);
  const engagementUsers = firstMetric(engage, 1);
  const avgEngagementSec = engagementUsers
    ? Math.round(engagementTotal / engagementUsers)
    : 0;

  return {
    range,

    /* ---------- 상단 KPI ---------- */
    totalUsers: firstMetric(total),
    todayUsers,
    todayDeltaPct: pctChange(todayUsers, firstMetric(yesterday)),
    weekUsers,
    weekDeltaPct: pctChange(weekUsers, firstMetric(prevWeek)),
    monthUsers,
    monthDeltaPct: pctChange(monthUsers, firstMetric(prevMonth)),
    avgEngagementSec,
    contactClicks: firstMetric(contact),
    /* /resume 과 /resume/ 가 따로 잡히므로 다 더한다 */
    profileViews: toRows(profile).reduce((a, r) => a + r.value, 0),

    /* ---------- 아래 패널 ---------- */

    /* 유입 경로·국가·페이지는 "한글 이름으로 바꾼 뒤 합치고 상위 5개" 순서다.
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

    /* /3d-art 와 /3d-art/ 처럼 같은 페이지가 갈라져 들어온다 */
    pages: mergeByName(
      toRows(pages).map(r => ({ name: pageName(r.key), views: r.value })),
      "views", 5
    ),

    /* 썸네일을 눌러 크게 본 작품. 맞춤 측정기준 미등록이면 빈 배열이 온다. */
    artworks: toRows(artworks).map(r => ({ name: r.key, views: r.value })),

    /* 아래 셋은 항목이 정해져 있으므로, 값이 없어도 줄을 지우지 않고 0 으로
       채운다. "모바일이 0" / "한국어가 0" 같은 것도 그 자체로 정보다. */
    devices: fixedRows(DEVICE_NAMES, toRows(devices), "users"),
    visitors: fixedRows(VISITOR_NAMES, toRows(visitorType), "users"),
    languages: fixedRows(LANG_NAMES, toRows(languages), "views")
  };
}

/* GA4 는 한 속성에 동시 요청 수 제한이 있다. 17개를 한꺼번에 던지면
   일부가 "동시 요청 할당량 초과"로 떨어질 수 있으므로 몇 개씩 나눠 보낸다.
   결과는 넘긴 순서 그대로 돌려준다. */
async function runInChunks(tasks, size) {
  const out = [];
  for (let i = 0; i < tasks.length; i += size) {
    const part = await Promise.all(tasks.slice(i, i + size).map(fn => fn()));
    out.push(...part);
  }
  return out;
}
