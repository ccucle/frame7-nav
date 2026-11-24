# FORMDAY Connect — 월 0원 경로와 저장 후 검증

확인일: 2026-11-24, Asia/Seoul.

**사용자 확정 조건: 이번 연결의 추가 운영비는 월 0원이다. 한도를 넘으면 과금하는 구성은 선택하지 않는다. 실제 Firebase 연결·개인 기록 조회/저장·iPhone/PC 일치 검증은 아직 완료되지 않았다.**

## 1. 비용 결정

우선 후보는 **Cloudflare Workers Free + SQLite 기반 Durable Objects**다. 기존 FORMDAY 정적 사이트와 기존 Firebase 건강 기록 저장소는 유지한다. 별도 Firebase 프로젝트의 Admin 저장소를 새로 만드는 기존 Node 배포안은 이 무료 후보의 필수 조건이 아니다. 인증 상태를 분리된 DO 저장소에 두려면 새 런타임 어댑터와 보안 검증이 필요하다. 현재 Node entry를 그대로 배포할 수 있는 완제품으로 취급하지 않는다.

| 구성 | 확인한 공식 정책 | 이번 판단 |
| --- | --- | --- |
| Workers Free | 일 100,000 요청 한도 초과 시 Error 1027. 일반 Worker CPU 10ms/요청 | 계정이 실제 Workers Free인지 확인 후 사용 후보. 도메인 Free 플랜과 혼동하지 않는다. |
| SQLite Durable Objects, Workers Free | 무료 한도를 넘는 작업은 오류로 실패. Free에서 사용 가능 | 인증 상태 저장 및 처리 후보. 기존 Firebase와 분리한다. |
| D1, Workers Free | 읽기·쓰기 일 한도 초과 시 쿼리 오류, 저장 한도 초과 시 추가 저장 불가 | 비용 조건은 후보이나 현재 reader의 CPU 부담 때문에 DO를 우선 검토한다. |
| Sites | 2026-12-31까지 무료. 2027-01-01부터 월 공유 제공량 초과 사용 과금 | 실제 0원 상한/초과 과금 차단 기능을 확인하지 못해 선택하지 않는다. |
| Render Free | 결제수단이 연결되어 있으면 workspace 초과 bandwidth 과금. 없으면 서비스 중단 | 현재 계정의 결제 조건 미확인. 기존 사이트·NOVA와 공유 한도에 영향을 주는 새 서비스를 만들지 않는다. |
| 기존 Firebase | Spark는 무료량 초과 시 제한. Blaze는 초과 사용량 과금 | 실제 프로젝트 요금제 확인이 필요하다. 임의로 플랜을 내리거나 Billing을 해제하지 않는다. |

공식 근거:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)
- [Sites usage and cost](https://learn.chatgpt.com/docs/sites/usage-and-cost)
- [Render outbound bandwidth](https://render.com/docs/outbound-bandwidth)
- [Render free services](https://render.com/docs/free)
- [Firebase pricing plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)

사진 해석은 ChatGPT가 담당하고 서버는 사용자가 확인한 음식·분량·추정 표시만 받는 구성을 유지한다. 별도 AI API, 사진 원본 저장, 유료 도메인, 유료 Worker, 유료 trial, Firebase Blaze 전환을 추가하지 않는다. 현재 ChatGPT 사용료와 기존 서비스 비용을 이번 연결의 무료 호스팅 주장으로 바꾸어 설명하지 않는다.

무료 한도에 도달하면 연결이 잠시 실패할 수 있다. 그때 유료 전환이나 새 기록의 무조건 재전송을 하지 않는다. 조회/저장 실패 또는 결과 불명확 상태를 정확히 알리고 동일 작업 상태를 먼저 확인한다. 서비스 약관의 영구 불변을 보장하는 주장이 아니라 현재 Free 요금제의 강제 한도를 이용하는 설계다.

## 2. 실제 모바일·계정 관측

- 이 세션에 `formday-assistant` 스킬이 새로 제공됐다. 읽어 확인한 릴리스에는 MCP 서버·연결 앱·자격 증명·조회/저장 도구가 없다. 초안 생성 지침이며 사이트 연결 완료의 증거가 아니다.
- FORMDAY/Cloudflare 플러그인 검색은 각각 빈 결과였다. 현재 노출된 실행 도구에도 FORMDAY·Firebase·Cloudflare 런타임 도구가 없다. 검색이 전체 디렉터리를 완전히 열거한다는 주장은 하지 않는다.
- GitHub PR #7 head `bbcd5eb5a3f09775c06554d7184938a598378045`, PR #10 head `c6191e269cb2344c99a05b86cd38b47735077d2d`를 이번 수정 전 재확인했다. 둘 다 초안·미병합이었다.
- Render 운영본은 다른 작업의 **v0.7.1**, 커밋 `ca4e67cdf5020b0a0147832e8650ea7931a894c7`, 배포 `dep-dc2e5hbncjis73cmq6q0`, 2026-11-24 10:05:26 KST 완료로 조회됐다. 이 작업은 운영 사이트를 변경하거나 배포하지 않았다.
- Cloudflare 계정/구독과 기존 Firebase Spark/Blaze는 아직 인증된 화면/API로 확인하지 못했다. 따라서 전체 비용 0원 충족 또는 실제 연결 성공으로 판정하지 않는다.

공식 문서는 외부 HTTPS Streamable HTTP MCP와 OAuth를 선언하는 플러그인 형식을 지원한다. 계정에 제공된 모바일 클라우드 플러그인의 지원과 직접 custom MCP 등록의 웹 전용 제한은 별개다. 외부 서버 주소를 패키지에 넣는 것만으로 iPhone 도구 실행이 입증되지는 않는다.

- [Plugin MCP authentication format](https://developers.openai.com/plugins/build/plugins#configure-mcp-authentication)
- [Mobile plugin support](https://learn.chatgpt.com/docs/plugins)
- [Direct custom MCP connection limitations](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)

실제 endpoint·OAuth discovery·도구 목록을 검증한 후 기존 FORMDAY 플러그인의 현재 ID/릴리스를 확인해 업데이트한다. 가짜 endpoint, 공유 고정 토큰 또는 로컬 서버를 모바일 연결로 보고하지 않는다.

## 3. 무료 런타임에서 재사용할 부분

`reader.mjs`, 사용자 ID token 기반 Firestore REST, UID에서 정한 두 문서 경로, scope/PKCE/resource 바인딩, 조건부 append는 재사용 후보다. Node HTTP/fs entry와 firebase-admin 기반 OAuth 저장소는 Workers에 그대로 이식하지 않는다.

현재 reader는 큰 JSON 문서와 최대 367일 반복 조회를 처리한다. 일반 Free Worker의 CPU 10ms 안에서 안전하다고 검증되지 않았다. 얇은 Worker가 요청을 전달하고 DO에서 인증·파싱·조회와 원자적 인증 저장을 처리하는 방식을 우선 검토한다. DO의 CPU 한도는 기본 요청당 30초로 문서화되어 있으나 실제 무료 환경 성능·할당량 시험은 별도다. [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

초기 실제 읽기는 기존 로그인 계정에 대한 상태 확인과 단일 날짜 조회부터 시작한다. Firebase 사용자의 기존 세션에서 정식 HTTPS 연결 절차로 ID token을 전달하고, 검증된 UID에만 접근해야 한다. refresh token 보관을 켜기 전에 원자적 토큰 발행, 철회, 동시 갱신, 요청량 제한, 만료 정리를 완성한다. 장기 토큰 보관 없이 짧은 읽기 연결만 시험하면 그 만료/재연결 제한을 명시한다.

Wrangler 4.167.0의 실제 `login --help`에서 `--device`를 확인했다. 공식 device flow는 아이폰에서 Cloudflare의 짧은 승인 코드를 입력해 CLI에 직접 권한을 줄 수 있다. 이는 사용자가 Firebase 로그인 토큰을 채팅으로 보내는 방식이 아니다. 실제 인증은 별도 단계이며 기본 전체 scopes 대신 필요한 권한만 요청해야 한다.

- [Wrangler device flow](https://developers.cloudflare.com/changelog/post/2026-08-04-wrangler-login-device-flow/)
- [Wrangler login and credential storage](https://developers.cloudflare.com/workers/wrangler/commands/general/)

## 4. 이번 코드 수정: 저장 후 반드시 재조회

수정 파일은 `src/append.mjs`, `test/append.test.mjs`다.

1. 기존처럼 최신 원본과 미리보기의 UID·resource·scope·만료·revision·updateTime을 검증한다.
2. 원본 JSON의 다른 필드를 유지하며 요청한 항목 한 개만 조건부 추가한다.
3. 쓰기 승인 후 같은 인증 사용자의 같은 문서를 서버에서 다시 읽는다.
4. 동일 ID가 정확히 하나 존재하고 내용이 미리보기와 정확히 같을 때만 `saved`, `readBackVerified: true`를 반환한다. revision은 재조회한 실제 버전이다.
5. 재조회 실패·항목 누락·항목 변경은 성공으로 반환하지 않는다. 사이트의 무관한 후속 수정은 그대로 유지하며 다시 덮어쓰지 않는다.
6. POST 응답 유실 시 자동 재전송하지 않는다. 동일 previewToken 재시도에서 서버 기록을 읽어 `already_saved` 여부를 확인한다. 새 미리보기 발급으로 중복을 만들지 않는다.

검증 결과: Node 24.22.3 전체 **86개 통과, 0개 실패**. 기존 81개에서 새 테스트 5개를 추가하고 기존 2개를 강화했다. 최초 재조회 변경은 수정 전 실패 6개를 재현했다. 마지막 중복 ID 검사는 기존 normalizer가 이미 거부하던 손상 문서에 대한 보호 동작 확인이며 신규 취약점 재현으로 집계하지 않는다. append 테스트는 20개다.

모든 테스트는 모의 계정·모의 기록이다. 실제 Firebase와 Cloudflare에 기록을 생성하지 않았다. GitHub Node 22·24 결과는 해당 푸시 커밋의 Actions에서 별도 확인한다.

## 5. 남은 완료 조건

- 실제 Workers Free 및 기존 Firebase의 비용 조건 확인.
- 무료 런타임/독립 인증 저장소 이식과 인증 실패·철회·경쟁 검증.
- 본인 계정의 실제 기존 기록을 iPhone ChatGPT에서 읽는 도구 호출 성공.
- 서로 다른 미리보기를 만드는 반복 요청까지 처리하는 영속 중복 방지.
- 최신 운영 v0.7.1 이후 필드와 기존 웹 동기화 충돌 처리 검증.
- 합의한 시험 기록 범위에서 일정 → 프로그램 → 식단 추가, 저장 후 서버 재조회, PC/iPhone 같은 기록 확인.

쓰기 기능은 계속 기본 비활성이다. 실제 시험 기록의 날짜·항목·개수·정리 범위를 임의로 만들지 않는다. 코드 작성·테스트·서버 배포·플러그인 설치·사용자 인증·실제 저장·두 기기 일치의 완료 여부를 각각 보고한다.
