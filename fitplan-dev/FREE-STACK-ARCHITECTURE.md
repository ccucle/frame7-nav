# FORMDAY · 무료 클라우드 동기화/백업/리포트 설계 결정서

결정일: 2026-11-23, KST  
대상: 현재 운영 FORMDAY v0.3.1 / 브라우저 저장 형식 v3  
비용 조건: **이 프로젝트의 추가 운영비 0원**  
상태: **공식 무료 한도 및 기존 코드 구조 확인 완료. 계정 연결·사용자 기록 이전·운영 배포는 미진행.**

## 1. 확정 조합

- **Firebase Spark (Authentication + Firestore Standard):** 로그인과 기기 간 실사용 기록 동기화. 사용자의 브라우저 기록은 로그인만으로 업로드하지 않음
- **Google Drive:** 버전별 JSON 독립 복구 파일. 잘못 삭제하거나 동기화한 기록을 이전 시점으로 되돌리는 용도
- **Notion:** 주간·월간 웨이트·유산소·식단·체중 **요약 리포트**. 모든 원본 기록을 무분별하게 복제하지 않음
- **현재 브라우저:** 무료 클라우드 연결이 끊기거나 한도가 초과돼도 기기 내 기록은 유지. 기존 로컬 저장소는 검증 전 삭제·초기화하지 않음

## 2. 공식 무료 한도와 금지 항목

| 서비스 | 확인한 무료 범위 | 주의 |
| --- | --- | --- |
| Firebase Spark | 결제 없는 무료 요금제. Blaze로 올리지 않음 | Cloud Billing을 연결하면 Blaze로 바뀔 수 있음 |
| Firestore Standard | 1GiB 저장, 읽기 50,000/일, 쓰기 20,000/일, 삭제 20,000/일, 전송 10GiB/월 | 프로젝트당 무료 DB 한 개. 초과하면 사용이 제한될 수 있음 |
| Firestore 문서 | 한 문서 최대 1MiB | 전체 v3 JSON을 한 문서에 저장하지 않고 개별 기록으로 분리 |
| Firestore 관리형 Backup/Restore/PITR/TTL | 무료 할당량 제외 | 이번 프로젝트에서 사용하지 않음 |
| Firebase Auth | 기본 Google 로그인 등 무료 범위의 공급자 | 전화번호 SMS, 유료 업그레이드, 임의 유료 서비스는 사용 금지 |
| Google Drive | Google 계정의 잔여 무료 저장량 | 별도 OAuth 권한, 저장 공간 확인 필요 |
| Notion Free | 업로드 파일당 5MB | 원본 백업 저장소가 아닌 요약 리포트로 사용 |

출처:
- https://firebase.google.com/docs/firestore/pricing
- https://firebase.google.com/docs/projects/billing/firebase-pricing-plans
- https://firebase.google.com/docs/firestore/quotas
- https://firebase.google.com/docs/auth/limits
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://www.notion.com/pricing

## 3. 데이터 설계 기준 (확정 이전의 제안 스키마)

- users/{uid}/profile/main: 영양 목표, 설정, 스키마 버전 및 동기화 메타데이터
- users/{uid}/events/{eventId}: 웨이트·유산소·식단·체중 이벤트 기본 정보
- users/{uid}/occurrences/{eventId_date}: 반복 일정의 날짜별 수행·섭취·측정 기록
- users/{uid}/exclusions/{eventId_date}: 반복 일정 특정 날짜 제외
- users/{uid}/foods/{foodId}: 직접 등록한 식품
- users/{uid}/favorites/{foodId}: 즐겨찾기

원본 이벤트 ID, 반복 날짜, 웨이트 세트별 중량·횟수·RPE, 음식 스냅샷의 기준량·출처·누락값(null), 체중 측정 완료 표시를 그대로 보존한다. 배열의 순서가 필요한 데이터에는 원래 순서를 명시한다. 한 문서의 크기 제한을 넘으면 무조건 업로드를 실패로 판단하며 자동 절단·요약하지 않는다.

**Firestore Security Rules 필수:** 인증된 요청의 uid와 경로의 uid가 일치할 때만 읽기/수정. 다른 계정, 비로그인, 문서 소유자 위조, 버전 충돌, 비정상 크기·필드 입력 거부. Firebase Emulator로 사용자 A/B 교차 접근 및 규칙 회귀 시험 통과 전 배포하지 않는다.

## 4. 복구용 Google Drive 설계

- 기본 저장소는 Google Drive의 **사용자에게 보이는 FORMDAY BACKUP 폴더**. 앱 전용 숨김(appDataFolder)은 앱 연결 해제/삭제 시 데이터 보존·접근에 한계가 있으므로 기본 옵션으로 사용하지 않음.
- 최소 접근 범위: **drive.file**. Firebase 로그인은 Drive 파일 권한을 자동으로 제공하지 않으므로 사용자의 별도 OAuth 동의가 필요함.
- 백업 성공의 정의: JSON 생성 → Drive 업로드 → Drive 파일 ID 조회 → 실제 파일 다시 다운로드 → SHA-256/원본 스키마/건수 및 주요 수치 대조까지 통과.
- Google 브라우저 OAuth의 토큰은 만료될 수 있으므로 매일 무인 백업을 단정하지 않음. 사용자 승인이 필요한 경우 표시. 초기에는 주 1회 + 데이터 이전 직전 수동 백업을 기준으로 검증.
- Drive 저장 공간 부족, 권한 만료, API 오류, 파일 손상 시 원본은 그대로 보존. 백업 실패가 동기화 성공으로 둔갑하지 않게 별도 상태 사용.

출처:
- https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- https://developers.google.com/workspace/drive/api/guides/appdata
- https://developers.google.com/identity/oauth2/web/guides/use-token-model

## 5. Notion 리포트 설계

- 주간 운동 완료 일수, 본 세트 운동량, 유산소 시간·거리, 완료된 식사의 kcal/탄수화물/단백질/총 지방/그중 불포화지방, 실제 측정 체중의 추세를 포함.
- 리포트 기간(KST), 생성 시각, 실제 기록 개수, 미확인 영양소 개수를 반드시 표시. 미확인을 0으로 추정하지 않음.
- 사용자가 승인한 비공개 Notion 페이지/DB에만 게시하며, 원본 전체 백업은 Drive에서 담당.
- 공개 정적 사이트의 JavaScript에 Notion 비밀 토큰·관리자 API 키를 넣지 않음. 안전한 승인된 연결이 없으면 먼저 리포트 초안만 생성하고 자동 게시했다고 말하지 않음.

## 6. 데이터 이전·복원 원칙

1. 기존 원본이 있는 위치는 사용자의 Safari/브라우저다. 개발자가 사용자의 로컬 저장소를 원격으로 직접 읽을 수는 없다.
2. 사용자가 기존 사이트에서 **JSON 내보내기**를 실행하고 파일 앱에서 백업 파일의 존재를 확인.
3. v1·v2·v3 형식의 합성 테스트를 먼저 통과. 시험용 개인 기록만 사용하고 실제 건강 데이터는 공개 저장소에 업로드하지 않음.
4. 원본 v3를 정규화한 뒤 이벤트별/반복별/식품별로 분리하고, 다시 복원했을 때 이벤트·세트·식사·영양값·체중·즐겨찾기·목표를 비교.
5. Firebase 로그인 뒤 **명시적 업로드 승인**을 받아 별도 경로에 복사. 다운로드 후 재검증 결과가 일치할 때만 동기화 활성화.
6. 클라우드/기기 버전이 동시에 바뀌면 자동 덮어쓰기를 금지. 각 버전을 백업하고 사용할 쪽을 사용자가 결정.
7. 실패 시 동기화를 끄고 기존 브라우저 기록 + Drive JSON 복원을 사용. 기존 키/계정/서버 기록을 임의 삭제하지 않음.

## 7. 단계별 검증 게이트

| 단계 | PASS 기준 | 현재 상태 |
| --- | --- | --- |
| G0 무료 정책 | Spark/Firestore/Drive/Notion 무료·제약 공식 확인, 유료 옵션 제외 | PASS: 정책 검토 |
| G1 기존 기록 | v3 백업 파일 실제 생성·재읽기·복원, 로컬 원본 변경 0 | 코드 구조 확인 / 사용자의 실제 브라우저 실증 필요 |
| G2 Firebase 준비 | 접근 가능한 Spark 프로젝트, Cloud Billing 비연결, 무료 DB 1개, 인증 제공자 확인 | 대기: Firebase 연결 필요 |
| G3 보안과 동기화 | Emulator 유저 A/B 접근 차단, 반복일정 무손실 복원, 오프라인·충돌 시험 | 미착수 |
| G4 Drive 독립 백업 | 최소 권한 OAuth, 업로드·재다운로드·SHA-256·지정 시점 복원 | 미착수 |
| G5 Notion 리포트 | 본문 수치 검산, 누락값 보존, 비공개 대상 저장·재조회 | 미착수 |
| G6 최종 검증 | iPhone Safari + 별도 기기, 데이터 0건 손실, 추가 비용 0원, 운영 복구 가능 | 미착수 |

### 운영 활성화 금지 조건

- 사용자 개인 데이터로 검증 전에 운영 사이트를 새 동기화 코드로 교체하지 않음
- Firestore 전체 공개 규칙, 관리자 비밀키 노출, Drive 광범위 권한, Notion 토큰 노출 금지
- Firebase Blaze 업그레이드, Cloud Billing 연결, 유료 Firebase 관리형 백업/TTL/Functions 사용 금지
- 서비스 무료 한도 초과 때 기록 버리거나 사용자 동의 없이 유료 전환하지 않음

## 8. 현재 실제 상태

- 기존 웹사이트는 **v0.3.1**이며 브라우저 저장 + JSON 파일 내보내기/복원을 제공함.
- 새로운 Firebase 프로젝트, Google Drive OAuth, Notion 자동 리포트 연동은 아직 연결되지 않았음.
- 기존 Render 정적 서비스 및 저장 데이터를 바꾸지 않고 별도 설계 브랜치에서 전환을 준비함.
- Github 저장소에는 스키마와 테스트 코드만 보관하며 사용자의 개인 건강 기록을 커밋하지 않음.
