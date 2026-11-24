# FORMDAY Connect — Phase 5 mobile route and read correctness

검증일: 2026-11-24 (Asia/Seoul). 이 문서는 실제 계정/도구 조회, 공식 문서, 코드 검토, 모의 검증을 구분한다.

**상태: 읽기 코드 보완 단계. FORMDAY 연결 서버 미배포, 전용 플러그인 미생성·미설치, 실제 Firebase 사용자 연결 미완료. 실제 개인 기록 조회/저장 및 PC·iPhone 교차 검증은 아직 0회다.**

## 1. 기준 코드와 운영 보존

- 개발 시작점: PR #7, `formday-connect-oauth-20261123`, `2d5ca6da5c04b3cd51387c4108bc5e9d390bfcd0`.
- 작업 중 다른 변경이 같은 PR에 커밋 `bbcd5eb5a3f09775c06554d7184938a598378045`로 추가됐다. 기존 head 조건부 갱신이 거부된 뒤 원격 head를 재조회했다. 새 변경을 덮어쓰지 않고 이 커밋을 기준으로 별도 모바일/읽기 보완 브랜치를 구성한다.
- 동시 변경에는 기본 비활성 append 미리보기/저장 도구와 프로그램 요약·식사 영양 기준/메모 조회가 포함된다. 이번 보완은 해당 코드를 보존하고 읽기 의미를 통합한다. 쓰기 활성화·배포·실제 사용 승인이 아니다.
- PR은 open/draft/미병합으로 확인했다. 이전 Node 22·24 Actions jobs는 성공이다. 기존 47개 테스트는 모의 인증·모의 저장소 기반이다.
- 현재 운영 브랜치는 `fitplan-site-20261123`, 커밋 `3c6cc4adf5fda21a2d205ceb0738ad06877dc43f` (v0.6.1)이다.
- Render 실제 배포 `dep-dc2ciqp7lnhs73e1u0e0`는 같은 커밋을 `live`로 반환했다. 배포 완료는 2026-11-24 08:17:08 KST다.
- 기존 FORMDAY 서비스는 **static_site**이며 연결용 Node 백엔드는 아니다. 기존 주소의 `?v=0.5.0`은 배포 커밋의 증거가 아니다.
- 기능 수정 범위는 `formday-connect/`이며 CI 대상 브랜치만 추가한다. 운영 `fitplan/`, 기존 데이터, Firebase 규칙, Render 배포·과금 설정은 변경하지 않는다.
- 별도 후속 PR에서도 기존 Node 22·24 검사가 실행되도록 CI의 pull_request 대상에 PR #7 개발 브랜치를 추가한다. 실행 명령·권한·runner·비밀값은 바꾸지 않는다.

근거: [PR #7](https://github.com/ccucle/frame7-nav/pull/7), [기존 CI](https://github.com/ccucle/frame7-nav/actions/runs/45206048639), [운영 커밋](https://github.com/ccucle/frame7-nav/commit/3c6cc4adf5fda21a2d205ceb0738ad06877dc43f), [Render 서비스](https://dashboard.render.com/static/srv-dc1pq5mtlv9c73cp3s5g).

## 2. 이번 모바일 세션에서 실제 확인한 연결 상태

| 대상 | 관측 결과 | 확인한 범위와 한계 |
| --- | --- | --- |
| GitHub | 계정 `ccucle` 조회 및 저장소/PR/코드/CI 읽기 성공 | 개발자료 접근 확인. Firebase 데이터 권한을 의미하지 않는다. |
| Sites | 본인 소유 Site 목록 3개 조회 성공; FORMDAY Site 없음 | Sites 읽기 도구 실행 확인. 신규 게시/MCP 플러그인 생성은 시험하지 않았다. |
| Render | 해당 계정 workspace의 서비스 및 운영 배포 조회 성공 | FORMDAY 정적 사이트와 다른 기존 서비스가 보인다. FORMDAY Connect 서비스는 없다. |
| Firebase | 플러그인 검색에는 installed=true. 권한 조회는 이름과 정확한 ID 모두 not_installed. 이 세션의 실행 도구 목록에는 Firebase 도구가 없다. | 상태 표시가 일치하지 않으며, 실제 Firebase 계정 연결 또는 데이터 권한으로 인정하지 않는다. |
| FORMDAY 전용 연결 | 플러그인 검색 결과 없음, 호출 가능한 도구 없음 | 읽기·쓰기 도구가 현재 제공되지 않는다. |
| Sites의 기존 앱 연결 | 필요한 `list_plugin_eligibility` 실행 도구 없음 | Firebase 플러그인을 Sites에서 그대로 호출할 수 있다고 가정하지 않는다. |

GitHub·Render의 앱별 설정은 Allow all actions, Sites는 기본 Allow low-risk actions로 조회됐다. 이는 작업 승인 정책이며 외부 시스템 OAuth scope 또는 실제 계정 데이터 접근권한과 다르다. 설정은 변경하지 않았다.

## 3. 모바일 경로 판정

| 경로 | 판정 |
| --- | --- |
| PC 로컬 MCP 설정/로컬 앱을 모바일에 자동 제공 | 공식 문서상 불가. 계정에 플러그인을 저장해도 로컬 도구는 웹·모바일에 자동 제공되지 않는다. |
| 사용자 정의 MCP 서버 주소를 직접 등록 | 현재 공식 직접 연결 안내는 웹 전용. 이 경로만으로 iPhone 지원을 약속할 수 없다. |
| 계정에 제공된 클라우드 플러그인 | 공식적으로 모바일 Chat·Work에서 지원. 개별 도구의 제공·인증·실행은 별도 검증해야 한다. |
| Sites 호스팅 MCP + 생성된 전용 플러그인 | 우선 검토 후보. Sites가 ChatGPT↔MCP 인증을 맡아도 외부 Firebase 계정 연결은 별도다. 현재 FORMDAY에 대해서는 미구현·미검증이다. |
| 기존 원격 MCP를 독립 클라우드 플러그인으로 포장 | 실제 배포된 endpoint, 지원 transport, OAuth, 도구 발견, 계정별 배포 자격을 먼저 확인해야 한다. 현재 서버는 미배포이므로 즉시 사용할 수 없다. |
| iPhone 브라우저에서 기존 사이트에 직접 등록 | 별도 대안. ChatGPT 내부 요청의 자동 저장 목표를 달성한 것으로 처리하지 않는다. |

공식 출처(2026-11-24 열람):

- [Plugins — mobile Chat/Work support](https://learn.chatgpt.com/docs/plugins)
- [Plugins in ChatGPT — local tools and account authorization](https://help.openai.com/en/articles/20001256-plugins-in-chatgpt)
- [Custom MCP connections — web-only FAQ](https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt)
- [Hosting a plugin with ChatGPT Sites](https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites)
- [MCP — Sites sign-in vs external API access](https://learn.chatgpt.com/docs/extend/mcp)

각 문서가 설명하는 연결 경로는 다르다. 직접 custom MCP 등록의 제약을 모든 클라우드 플러그인으로 확대하지 않으며, 일반적인 모바일 지원 문구도 개별 FORMDAY 연결 성공의 증거로 삼지 않는다.

## 4. Firebase 인증과 재사용 판단

기존 데이터는 검증된 Firebase UID 아래 두 문서에 저장된다.

```text
users/{verifiedFirebaseUid}/formday_sync/calendar
users/{verifiedFirebaseUid}/formday_sync/iron
```

외부 문서 형식은 `format`, `revision`, `payload` JSON 문자열, `updatedAt`이다. 현재 사용자토큰 REST reader는 이 두 경로만 허용한다. Firebase ID token으로 Firestore REST에 접근하면 기존 Security Rules를 적용한다. 이 구조와 UID/path 입력 차단은 재사용한다. [Firebase 공식 REST 인증](https://firebase.google.com/docs/firestore/use-rest-api)

Sites의 사용자 ID는 Site 범위 ID이며 Firebase UID가 아니다. 이메일이 같다는 이유만으로 매핑하지 않는다. 본인 계정의 정식 로그인으로 검증된 UID와 연결해야 한다. 관리자 키로 기존 건강 데이터의 규칙을 우회하지 않는다.

현재 Node OAuth 서버는 Sites Worker에 그대로 이식할 수 있는 완제품이 아니다. 다음 사항을 해소하기 전에는 실제 refresh token을 맡기지 않는다.

- grant/access/refresh 묶음의 부분 저장 실패 및 원자적 발행.
- 철회, 만료 정리, 토큰 계열 재사용 처리.
- 동시에 발생하는 Firebase 갱신과 credential 업데이트 충돌.
- 인증·token·MCP endpoint 요청량 제한.
- 기존 Firebase 프로젝트와 분리된 인증 저장소 및 실제 권한 격리.
- Google popup에서 다른 계정을 처음 선택해 새 Firebase Auth 사용자가 생기는 문제.
- HTTPS, Origin/CSRF, 콜백, 로그 비밀값 제거, 실제 브라우저 인증 검증.

기존 FORMDAY에서 이미 로그인한 사용자가 연결을 승인하는 방식을 우선 검토한다. 이 경우에도 기존 세션의 검증된 Firebase ID token과 단회성·짧은 만료·요청자 바인딩 연결 절차가 필요하며, 현재 구현된 기능이 아니다. 채팅에 로그인 토큰을 복사하는 방식은 사용하지 않는다.

연결 페이지는 기존 사이트와 같은 origin에서 현재 로그인 사용자 복원을 기다린 뒤 명시적 연결 동작을 받는다. 서버가 Firebase 서명·프로젝트·만료를 검증하고, 허용된 기존 문서를 읽어 연결 대상을 확인한다. 연결 중 계정이 바뀌면 중단하며 Sites ID와 Firebase UID의 기존 매핑을 자동 교체하지 않는다. 기록이 없는 계정을 신규 계정으로 단정하지 않고, 이 파일럿의 연결 검증 미완료로 처리한다.

연결 ticket에는 인증된 Sites 요청자, 대상 서비스, scope, state/nonce와 짧은 TTL을 묶고 원자적으로 한 번만 소비해야 한다. Origin/CORS만으로 인증을 대신하지 않는다. token은 URL·DOM·로그·채팅에 넣지 않는다. 초기 읽기 한 번은 단기 ID token으로 검증할 수 있지만, 지속 연결에는 별도 갱신 자격 증명 또는 매번 재인증 정책이 필요하다. 초기 읽기 성공과 지속 연결 성공도 분리한다.

근거: [Firebase ID token 검증](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [첫 Google 로그인과 사용자 생성](https://firebase.google.com/docs/auth/web/google-signin), [Firebase 세션 수명](https://firebase.google.com/docs/auth/admin/manage-sessions).

## 5. 읽기 코드 수정

검토에서 드러난 문제:

1. 기본 날짜가 UTC여서 한국 새벽에는 전날을 조회했다.
2. 기존 식사 항목 `{id, food, amount}`의 `amount`, `food.basisUnit`을 읽지 못했다.
3. 반복 일정이 최초 시작일로만 검색돼 지정 날짜의 일정이 누락됐다.
4. 일정별 시간과 날짜별 식단/체중 수정·완료 상태를 충분히 반영하지 않았다.

수정은 사이트의 실제 `core.js` 반복 의미와 `nutrition.js` 식사 형식에 맞춘다. 실제 발생일, 원본 시리즈 날짜, 시작/종료 시간, 제외일, 반복 종료일, 날짜별 snapshot을 구분한다. 완료되지 않은 반복 체중을 실제 측정값으로 재사용하지 않는다. 식사 분량·단위를 보존하고 ml/serving을 g으로 추정 변환하지 않는다. 영양 합계 및 사진 추정값은 생성하지 않는다.

### 검증

- 새 회귀검사 13개를 먼저 기존 reader에 실행해 13개 모두 실패함을 확인했다. 기존 reader 검사 8개는 통과했다.
- 수정 후 reader 검사 21개 전부 통과했다. 같은 날짜·시간의 체중 결과 정렬도 사이트와 대조해 추가 회귀검사 1개의 실패를 재현한 후 수정했다. 최종 reader 검사는 **22개 통과**다.
- Node v24.22.3에서 고정 lockfile로 `npm ci --ignore-scripts --prefer-offline --no-audit --no-fund`를 실행한 뒤 전체 `npm test`: **61개 통과, 0개 실패**.
- 전체 검사에는 실제 MCP SDK와 loopback HTTP를 사용한 모의 인증·도구 호출이 포함된다. 외부 Firebase와 인증 저장소는 여전히 모의 구현이다.
- 기준 코드의 GitHub CI는 Node 22·24 성공을 재확인했다. 이번 변경 커밋의 CI 상태는 PR의 해당 커밋에 연결된 checks에서 따로 확인한다.
- 실제 v0.6.1 `core.js`의 `normalizeState`, `dayEvents`, `weightRecords`를 별도로 실행해 2026-11-15~2026-12-07의 23일 × 3종 조회를 모의 데이터로 대조했고 **69회 일치**했다. 이는 61개 테스트에 더하는 별도 테스트 수가 아니라 일회 비교 횟수다. 입력 모의 기록의 불변성도 확인했다.
- 독립 검토에서 KST·반복·식단 단위·legacy 형식·타 UID 입력 차단 범위를 재확인했다. 운영 인증 보안 승인이나 실제 연결 검증은 아니다.
- 위 61개는 시작 커밋에 읽기 보완을 적용한 결과다. 이후 동시 변경 `bbcd5eb…`의 기존 67개 검사와 읽기 회귀 14개를 통합한 **현재 최종 전체 검사는 81개 통과, 0개 실패**이며 reader 검사는 23개다. 앞선 결과와 중복 합산하지 않는다. Node v24.22.3에서 실행했다.

원본은 GitHub blob SHA로 대조해 가져왔다. 테스트는 모의 기록만 사용하며 실제 UID·OAuth·Firestore 계정 연결을 증명하지 않는다. 동시 변경의 routines.programs/programTotal과 식단 nutritionBasisAmount/nutrientsPerBasis/notes를 보존했다. 영양 기준값은 저장된 유효 숫자만 그대로 반환하고 섭취량에 맞춰 환산하지 않는다. 루틴/프로그램 이름 검색·전체 페이지 처리, 완전한 달력 상세 반환은 후속 작업이다.

## 6. 쓰기 전에 필요한 데이터 계약

시작 커밋에는 쓰기 도구가 없었다. 작업 중 추가된 `bbcd5eb…`에는 미리보기 3개와 저장 도구 1개가 있지만 기본 비활성이며, 실제 읽기 연결조차 아직 확인하지 못했다. 활성화/실증 순서는 실제 읽기 연결 → 새 운동 일정 → 프로그램 → 사진 식단이다. 아래 요구사항을 코드가 일부 구현했다는 이유로 모두 충족했다고 판단하지 않는다.

- 명확한 요청은 해당 범위에서 처리한다. 모호한 날짜·루틴·식품·분량만 질문한다.
- 날짜는 Asia/Seoul의 실제 `YYYY-MM-DD`로 응답한다. 상대 요일 해석이 모호하면 확인한다.
- 현재 달력 일정은 `start`/`end`가 필요하고 운동 상세는 snapshot 형식이다. IRON `routineId` 참조 필드는 그대로 보존되지 않는다. 연결 의미와 시간 기본값을 먼저 정해야 한다.
- 프로그램은 기존 `routineIds`, `mode`, `weekdays`, `nextIndex`, `active` 형식을 지켜야 한다. 현재 routines의 프로그램 요약 조회로 기본 결과를 확인할 수 있으나 전체 페이지·동명이름 처리는 아직 필요하다.
- 사진 분량을 확정할 수 없으면 확인한다. 현 식사 형식의 `source.kind=user`를 AI 추정 영양값의 출처로 사용하지 않는다. 알 수 없는 값은 unknown/null로 유지할 수 있는지 UI와 함께 검증한다.
- 최신 문서를 읽어 요청된 새 항목만 추가하고, Firestore updateTime 또는 같은 transaction/revision 규약으로 동시 수정 충돌을 감지한다.
- 기존 웹앱은 서버 revision 충돌 시 동기화를 중단하며 자동 병합하지 않는다. 새 writer가 전체 blob을 무조건 덮어쓰면 안 된다.
- 시작 커밋의 REST reader는 updateTime을 버렸다. 동시 변경은 이를 보존하고 조건부 commit을 추가했지만 실제 Firestore 규칙 아래에서의 쓰기는 미검증이다.
- 안정적인 생성 ID와 영속 작업 상태로 재시도 중복을 막는다. 임의 idempotency 필드는 사이트 normalizer가 삭제할 수 있으므로 그것만 믿지 않는다.
- 동시 변경은 같은 서명 미리보기의 재시도를 다루지만, 새 미리보기는 별도 작업이다. 사용자가 같은 요청을 다시 말해 새 미리보기가 만들어지는 경우까지 중복 생성이 방지된다고 볼 수 없다. 모델이 결과 불명 상태에서 새 미리보기를 자동 생성하면 안 된다.
- 저장 직후 서버에서 다시 읽어 날짜/ID/내용을 확인한다. 응답 유실·결과 불명확 상태에서는 성공이라고 보고하지 않고 먼저 상태를 조회한다.
- 실제 시험 기록의 날짜·항목·개수·정리 범위는 사용자와 정한 후 진행한다. 삭제·일괄 덮어쓰기는 범위에 없다.

## 7. 비용 및 다음 배포 판단

Sites 공식 비용 안내는 2026-12-31까지 hosting 무료, 2027-01-01부터 월 제공량 초과 hosting 과금을 명시한다. 저장소가 있는 Site는 빈 DB도 기본 월 약 25 credits이며 트래픽·용량은 별도다. 모든 Site가 계정의 월 제공량을 공유한다. 이 계정의 현재 요금제 대응, 잔여량, 초과 과금 차단 설정은 이번 도구로 확인하지 못했다.

[Sites usage and cost](https://learn.chatgpt.com/docs/sites/usage-and-cost)

따라서 이번에는 Site, D1, 별도 Firebase 프로젝트, Render 연결 서버, 유료 플랜 또는 과금 설정을 생성하지 않았다. 기존의 정적 Render 사이트에 서버 endpoint가 있다고 가정하지 않는다. 신규 리소스 배포 전에 선택한 구조의 실제 비용 조건과 상한을 확인하고, 비용 발생 가능한 설정이면 사용자의 별도 승인을 받아야 한다.

다음 실제 검증 단계는 다음과 같다.

1. 개인용 비공개 클라우드 플러그인 경로와 비용 보호 조건 확정.
2. 인증 저장소 및 연결 절차 보완, 모의 장애/철회/경쟁 조건 검증.
3. 실제 계정 로그인은 승인된 로그인 화면에서 수행.
4. iPhone ChatGPT에 노출된 FORMDAY 도구로 기존 루틴/특정 날짜 기록 실제 조회.
5. PC와 iPhone의 같은 기존 사이트 기록 대조.
6. 합의된 시험 범위에서 새 일정→프로그램→식단 저장, 서버 재조회, 두 기기 대조.

완료 판정은 코드 작성, 자동 테스트, 서버 배포, 플러그인 설치, 본인 계정 연결, 실제 저장, 서버 재조회, PC·iPhone 일치를 각각 분리한다. 앞 단계 성공으로 뒤 단계 성공을 대신하지 않는다.
