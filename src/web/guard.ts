// [Define404] 다른 사이트에서 보낸 브라우저 쓰기 요청을 막는다 (CSRF 방어).
// 기준은 gyeonjeok-meo 운영본과 같다: Origin 이 있으면 허용 목록과 맞아야 하고,
// "null" 은 Sec-Fetch-Site: same-origin 일 때만, Origin 이 없으면 Sec-Fetch-Site: cross-site 만 거절한다.
// 서버끼리 부르는 요청(메일 클라이언트의 원클릭 수신 거부, 원격 MCP)은 둘 다 없으므로 통과한다.

export const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface GuardEnv {
  PUBLIC_URL?: string;
  MOCK?: string;
}

const LOCAL_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function allowedOrigin(origin: string, requestUrl: string, env: GuardEnv): boolean {
  if (origin === new URL(requestUrl).origin) return true;
  if (env.PUBLIC_URL) {
    try {
      if (origin === new URL(env.PUBLIC_URL).origin) return true;
    } catch {
      // 설정값이 주소가 아니면 무시한다
    }
  }
  return env.MOCK === "1" && LOCAL_DEV.test(origin);
}

/** 막아야 하면 이유를, 통과면 null 을 돌려준다 */
export function originBlock(method: string, headers: Headers, requestUrl: string, env: GuardEnv): string | null {
  if (SAFE_METHODS.has(method.toUpperCase())) return null;
  const origin = headers.get("Origin");
  const site = headers.get("Sec-Fetch-Site");
  if (origin === "null") return site === "same-origin" ? null : "origin not allowed";
  if (origin) return allowedOrigin(origin, requestUrl, env) ? null : "origin not allowed";
  return site === "cross-site" ? "cross-site request not allowed" : null;
}

/** JSON API 쓰기 경로는 application/json 만 받는다 (text/plain 같은 단순 요청으로 우회하지 못하게) */
export function isJson(headers: Headers): boolean {
  const t = (headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  return t === "application/json";
}
