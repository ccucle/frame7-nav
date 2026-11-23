# FORMDAY 무료 클라우드 전환: 사전 검증 기록

검증일: 2026-11-23 KST  
검증 대상: 현재 운영 v0.3.1의 Github 소스 (브라우저 저장 형식 v3), 실제 사용자의 로컬 기록은 접근하지 않음

## G0 비용·제약 확인

- **PASS**: Firebase Spark 무료 요금제, Standard Firestore 무료 할당량, 문서 1MiB 한도, 관리형 백업/복원 유료 조건을 공식 문서와 대조함.
- **PASS**: Google Drive 앱 전용 숨김 폴더와 사용자에게 보이는 폴더의 차이 및 최소 권한 설정 확인.
- **PASS**: Notion Free의 파일 업로드 5MB 제한 확인.
- **PASS**: 계획에 Blaze, Cloud Billing, Cloud Functions 등 추가 결제를 요구하는 항목을 제외.
- **주의**: 사용자의 실제 Firebase 프로젝트 및 Google 계정 무료 잔여 저장량은 아직 확인하지 않음.

## G1 기존 기록 사전검증

Github에 배포된 실제 FormdayData, FormdayNutrition, FormdayCore, FormdayBackup 소스를 JavaScript 실행 환경에 로드해 **10개 확인 항목 전부 PASS**:

1. 완료한 닭가슴살 150g의 기존 샘플 열량 247.5 kcal 보존
2. 주간 반복 운동의 2개 날짜별 완료 기록 보존
3. 해당 날짜의 운동량 1,800kg(중량×횟수 합계) 보존
4. 완료 체중 80kg 및 체지방 18.5% 보존
5. 직접 등록한 45g 기준 식품과 불포화지방 null 유지
6. 즐겨찾기 식품 ID 보존
7. 영양 목표 설정 보존
8. 백업 파일에 app=formday 및 version=3 표시
9. 저장/읽기/복원 후 정규화한 전체 JSON 데이터 동등
10. 백업 작업 전후 로컬 원본 raw 문자열 완전 동일

재현 가능한 Node.js 테스트 파일: free-stack.preflight.test.cjs (12개 테스트 케이스, 실행은 별도 검증 환경에서 재확인 필요).

## 검증 한계와 추가 통과 요건

- 이번 10개 확인은 **실제 사이트 코드로 만든 합성 시험 기록**에 대한 것. 사용자의 iPhone Safari 내부 데이터가 이미 Google Drive 또는 Firebase에 올라갔다고 주장할 수 없음.
- 실제 사용자가 백업 파일을 생성하고 파일 앱에서 존재를 확인한 뒤, 별도 테스트 장소에서 재읽기/복원 성공을 확인해야 G1 완전 PASS.
- Firebase 프로젝트가 연결되지 않았으므로 현재 사용자별 클라우드 문서, 보안 규칙, 두 기기 동기화, Drive OAuth·업로드, Notion 리포트 자동 발행은 모두 미검증.
- 실제 코드와 별개로 GitHub에 개인 건강정보, 인증 토큰, 결제정보를 커밋하지 않음.
- 운영 사이트는 변경하지 않았으며 v0.3.1의 브라우저 저장/파일 내보내기 기능을 유지함.
