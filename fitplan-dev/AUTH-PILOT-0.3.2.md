# FORMDAY Google 로그인 시범 연결 · v0.3.2

작성: 2026-11-23 (KST).
Firebase 프로젝트: healthy-df79f, 사용자가 Spark 무료 요금제임을 확인.
Google 로그인 사용 설정됨, Firestore (default) 및 deny-all 초기 규칙, Render 도메인 승인 완료.

## 이번 배포 범위

1. 기존 Render 정적 사이트에 Google 로그인 버튼과 계정 상태 표시 추가.
2. Firebase 공식 Google CDN의 웹 모듈 SDK 13.4.0 사용. Firebase Analytics, Firestore, Storage, Cloud Functions 코드 호출 없음.
3. Google 계정 로그인 및 로그아웃만 실행. Firestore 쓰기 및 운동·식단·체중 전송 없음.
4. 로그인 후에도 기존 브라우저 저장 공간에 운동·식단·체중 기록을 그대로 유지. 다른 계정으로 로그인해도 해당 로컬 기록은 자동으로 분리되지 않음. 공유 브라우저 사용 금지를 UI에 명시.
5. 로그인 취소, 팝업 차단, 승인되지 않은 도메인, 네트워크 실패 안내.
6. 기존 app.js, core.js, backup.js와 JSON 백업 형식은 그대로 유지. 로그인 코드에서 localStorage 읽기/쓰기를 하지 않음.
7. Spark 무료 한도와 요금제 유지. 추가 운영비 0원. 새 Firebase 또는 Render 과금 리소스 생성 없음.

## 실제 브라우저에서 검증해야 하는 항목

- Chrome과 iPhone Safari에서 사용자 주도로 Google 계정 팝업 로그인.
- 로그인·로그아웃 후 로컬 저장 기록 및 JSON 백업 파일 내용 불변 확인.
- Firestore 데이터베이스에 로그인만으로 기록 문서가 추가되지 않는지 확인.
- 팝업 차단, 취소, 네트워크 오류 시 기존 캘린더를 계속 사용할 수 있는지 확인.
- 로그인 상태는 클라우드 동기화 완료가 아님을 반드시 표시.

## 다음 단계 코드 (아직 활성화·배포 금지)

- cloud-model.js는 원본 v3 JSON을 profile/events/occurrences/exclusions/foods 문서로 나누고 무손실 복원하는 순수 데이터 변환기. 현재 로그인 UI가 호출하지 않음.
- fitplan-dev/firestore.rules는 사용자별 접근 제한 후보 규칙이며 실제 Firebase에 **적용하지 않음**. Emulator에서 타 사용자 접근 거부와 데이터 제약 검증 후 게시.
- 그다음 기기간 동기화, Drive 독립 백업, Notion 리포트 기능을 연동.

## 공식 출처

- https://firebase.google.com/docs/web/setup
- https://firebase.google.com/docs/auth/web/google-signin
- https://firebase.google.com/docs/auth/web/redirect-best-practices
- https://firebase.google.com/docs/firestore/security/rules-conditions
- https://firebase.google.com/docs/firestore/pricing
