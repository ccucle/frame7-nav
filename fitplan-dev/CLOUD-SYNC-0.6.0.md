# FORMDAY v0.6.0 — Google 계정 공통 데이터 동기화

## 목적
기존 Google Firebase Authentication 로그인으로 iPhone 홈 화면 웹앱, Safari 및 PC에서 같은 사용자 UID의 캘린더·유산소·식단·체중·이전 웨이트·독립 IRON MODE 세션·루틴을 공유한다.

## 아키텍처
- 프로젝트: `healthy-df79f` / Firestore `(default)` / Spark 무료 플랜 유지.
- 저장 경로: `users/{uid}/formday_sync/calendar` / `users/{uid}/formday_sync/iron`.
- 기존 브라우저 데이터는 그대로 유지. 실제 기록 JSON을 Firestore와 동기화한다.
- 최초 동기화는 각 저장 종류별 수동 업로드 확인. 새 기기에 로컬 기록이 없으면 서버에서 자동 내려받기. 두 기기 데이터가 다르면 자동 덮어쓰기 금지.
- 서버 변경은 실시간 리스너로 수신. 로컬 변경은 약 3.5초 후 서버 revision 검사 거래로 전송.
- 양쪽에서 동시에 변경하면 오류·충돌 상태로 중단하여 손실을 방지한다.
- 미완료 ACTIVE 웨이트가 다른 기기에서 보이면 바로 실행 세션을 복제하지 않고 원래 기기에서 일시정지/임시 보관/완료 후 수신한다.
- Firestore 문서당 JSON payload 최대 550KB 제한: 초과 시 로컬 보존 후 안내(향후 문서 분할 필요).
- 오프라인은 로컬 기록 유지; 온라인 복귀 후 충돌 검사 및 재연결.
- 사용자가 명시적으로 교체를 허가한 경우에도 로컬 기존 원본을 복구용 키에 우선 저장한다.
- Firebase Auth 계정 변경은 브라우저 로컬 데이터의 자동 분리와 동일하지 않음. 업로드 전 이메일 확인.

## 사용자가 해야 하는 최초 설정
1. 아이폰 기존 FORMDAY 아이콘 삭제 금지. 캘린더와 IRON MODE 각 JSON 백업을 실제 파일로 저장.
2. Firebase 콘솔 [Firestore Rules](https://console.firebase.google.com/project/healthy-df79f/firestore/rules)에서 [firestore.rules](./firestore.rules) 내용을 **기존 규칙과 비교 후** 게시. 다른 컬렉션을 전체 공개하지 않도록 주의.
3. 앱에서 기존 Google 계정 로그인 → `☁ 기기 동기화` → 이 기기 기록 최초 업로드를 각 종류별 실행.
4. PC / 다른 기기에서 동일 Google 계정으로 로그인 후 클라우드 기록 불러오기 확인.
5. 첫 연결 뒤에는 변경 사항 자동 전송 및 수신. 충돌 시 원본을 유지하고 사용자 선택.

## 보안 및 비용
- Firestore 접근은 `request.auth.uid == userId`인 소유자의 두 문서만 가능.
- 나머지 경로는 deny-all. 서버에서 사용자 간 데이터가 보이지 않아야 함.
- Spark 무료 데이터베이스 읽기·쓰기·보관 한도 내에서 동작, Blaze 결제 전환 없음.
- Firebase의 관리형 백업/복원/PITR 및 기타 유료 서비스 사용 안 함.
- 수동 JSON 백업은 계속 필요. 동기화와 백업은 별개임.

## 실제 기기 검증 잔여
- [ ] Firebase 규칙 실제 게시(현재는 별도 사용자 조치가 필요).
- [ ] 아이폰 최초 업로드 및 Firestore 콘솔 데이터 확인.
- [ ] PC 다운로드, 이후 PC 수정이 아이폰에 표시되는지 확인.
- [ ] 동시 편집 충돌, 오프라인 변경 재연결, 다른 UID 접근 거부 확인.
- [ ] 아이폰 홈 화면 앱 완전 종료 및 재실행 후 상태 확인.

## 검증 완료 수준
정책 함수 9개 사례 통과. 가상 기기 두 대에서 최초 업로드, 내려받기, 반대 기기 수정 전파 등의 모의 시나리오 7개 통과. **실제 Firestore와 iPhone-PC 검증은 아직 미완료**.

공식 자료: https://firebase.google.com/docs/firestore/quotas / https://firebase.google.com/docs/firestore/security/rules-conditions / https://firebase.google.com/docs/firestore/manage-data/transactions
