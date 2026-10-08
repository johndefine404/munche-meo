// [Define404] munche-meo: 광고성 정보 수신 동의의 유효 기간과 처리 결과 안내 메일
// 근거: 정보통신망법 제50조 제4항(보낸 곳·연락처·철회 방법 표시), 제7항(처리 결과 통지), 제8항(2년마다 재확인)

export const SENDER_NAME = "Define404";
// 광고성 정보 수신 동의는 2년이 지나면 끝난다. 다시 받으려면 본인이 다시 동의해야 한다
export const MARKETING_TTL_DAYS = 730;

export function marketingExpiresAt(consentAt: string): string {
  return new Date(Date.parse(consentAt) + MARKETING_TTL_DAYS * 86400000).toISOString();
}

// 저장된 동의가 지금도 유효한지 본다. 2년이 지난 동의는 없는 것으로 친다
export function marketingActive(row: { consent_marketing: number; consent_marketing_at: string | null }, now = new Date()): boolean {
  if (!row.consent_marketing || !row.consent_marketing_at) return false;
  return Date.parse(marketingExpiresAt(row.consent_marketing_at)) > now.getTime();
}

export type ConsentAction = "consent" | "refuse" | "withdraw" | "leave" | "expire";

const ACTION_TEXT: Record<ConsentAction, string> = {
  consent: "광고성 정보 수신에 동의하신 것으로 처리했습니다.",
  refuse: "광고성 정보 수신에 동의하지 않으신 것으로 처리했습니다. 광고성 메일은 보내지 않습니다.",
  withdraw: "광고성 정보 수신 동의를 철회하신 것으로 처리했습니다. 이후 광고성 메일은 보내지 않습니다.",
  leave: "탈퇴를 처리했습니다. 메일 주소, 동의 기록, 내 규칙, 가이드 문서를 지웠고 광고성 메일은 보내지 않습니다.",
  expire: "광고성 정보 수신에 동의하신 지 2년이 지나 동의를 종료했습니다. 계속 받으시려면 문체냥 화면에서 다시 동의해 주세요.",
};

// 처리 결과 안내 메일. 광고를 넣지 않는 안내 메일이라 제목에 (광고)를 붙이지 않는다
export function consentNotice(opts: { action: ConsentAction; at: string; contactUrl: string; unsubscribeUrl?: string }): { subject: string; text: string } {
  const lines = [
    "문체냥(munche-meo) 광고성 정보 수신 동의 처리 결과를 알려 드립니다.",
    "",
    ACTION_TEXT[opts.action],
    `처리 일시: ${opts.at}`,
  ];
  if (opts.action === "consent") {
    lines.push(`동의 유효 기간: ${marketingExpiresAt(opts.at).slice(0, 10)}까지 (2년이 지나면 동의를 종료하고 다시 묻습니다)`);
    if (opts.unsubscribeUrl) lines.push(`수신 거부(한 번 누르면 철회, 비용 없음): ${opts.unsubscribeUrl}`);
  }
  lines.push("", `보낸 곳: ${SENDER_NAME}`, `연락처: ${opts.contactUrl}`);
  return { subject: "[문체냥] 광고성 정보 수신 동의 처리 결과 안내", text: lines.join("\n") };
}
