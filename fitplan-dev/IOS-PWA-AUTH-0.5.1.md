# FORMDAY v0.5.1 · iOS 홈 화면 앱 로그인 문제 대응

작성: 2026-11-23 KST

## 재현 증상
iPhone Safari에서 홈 화면에 추가한 standalone FORMDAY의 Firebase Google 로그인 대화상자에서
'Google 로그인 창에서 계정을 선택해 주세요'라는 상태만 표시되고 인증이 완료되지 않음.

## 원인과 자료
- iOS 홈 화면 앱은 Safari 탭과 저장소·인증 컨테이너가 달라, 팝업 Google OAuth의 결과 전달이 제한될 수 있음.
- Google은 WKWebView와 같은 임베디드 환경의 OAuth를 제한함.
- Firebase는 OAuth 팝업이 모바일 환경에서 차단될 수 있다고 명시하며, redirect 흐름은 Safari의 서드파티 저장소 차단 이슈를 추가로 해결해야 함.
- 이전 cloud-auth.js에서는 signInWithPopup 실행 전에 await setPersistence를 호출했으며, 해당 await는 사용자 직접 제스처를 잃어 팝업 차단에 영향을 줄 수 있음.
- 정적 Render 호스트에서 authDomain만 onrender.com으로 변경하는 것은 공식 해결책이 아니며, Firebase auth helper용 동일 출처 프록시 없이 redirect를 배포하지 않음.

참고:
- https://developers.google.com/identity/protocols/oauth2/policies
- https://firebase.google.com/docs/auth/web/redirect-best-practices
- https://firebase.google.com/docs/auth/web/password-auth
- https://firebase.google.com/docs/auth/web/account-linking

## v0.5.1 변경
- iOS 홈 화면(standalone) 감지 시 동작하지 않을 수 있는 Google 팝업 호출을 숨기고, 이메일/비밀번호 대체 로그인 노출.
- Firebase의 공식 Email/Password Authentication API로 로그인 및 **사용자 명시적 가입** 지원.
- 일반 Safari Google 로그인은 사용자 클릭에서 직접 signInWithPopup 호출. 기존 선행 setPersistence await 제거.
- 이미 Safari Google 계정으로 로그인한 경우, **같은 Firebase 사용자 UID**에 이메일/비밀번호 제공업체를 추가하는 링크 동작 제공. 기존에 Google 계정을 사용한 사람은 별도의 신규 가입을 진행하지 않도록 주의.
- 실패 원인별 한글 안내. 비밀번호는 로그, UI 상태 파일, localStorage 또는 GitHub에 저장하지 않음.
- 기존 건강 기록과 독립 IRON MODE 루틴·운동 세션은 어떠한 OAuth 동작으로도 읽거나 덮어쓰지 않음.
- 현재 Firestore deny-all 보안 규칙 유지. Firebase Auth 로그인은 클라우드 데이터 동기화가 아님.
- 새로운 유료 서버, DB, Blaze, Billing 활성화 없음.

## 사용자의 Firebase 설정 필수
Authentication > 로그인 방법 > **이메일/비밀번호** 제공업체 사용 설정 후 저장.
이 프로젝트는 기존 healthy-df79f의 Spark 무료 요금제를 유지.
- https://console.firebase.google.com/project/healthy-df79f/authentication/providers

이미 Google로 Firebase 계정이 존재하는 경우:
1. 일반 Safari 브라우저에서 FORMDAY 열기.
2. Google 계정 로그인.
3. 로그인한 상태에서 '현재 Google 계정에 이메일 로그인 연결' 선택.
4. 기존 Google 이메일과 새 비밀번호를 입력/확인.
5. 홈 화면 앱에서 **같은 이메일/비밀번호**로 로그인.
이 링크 작업에 실패하면 자동 계정 병합을 하지 않으며 상태·오류를 안내한다.

기존 Google 계정이 없으면 홈 화면 앱에서 새 이메일 계정을 가입할 수 있음.
비밀번호·인증코드·서비스 계정 키를 채팅으로 전달하지 않음.

## 테스트 한계
- 동작 시뮬레이션: iOS standalone detection, email login, registration validation, Safari Google login, linking same Firebase user, desktop standalone behavior.
- 실제 Google OAuth, 이메일 제공업체 활성화, iPhone 홈 화면 로그인 및 같은 UID 여부는 사용자가 콘솔과 기기에서 직접 검증 필요.
- 브라우저 앱 아이콘 삭제/웹사이트 데이터 삭제를 권장하지 않음: 기록 손실 위험.
