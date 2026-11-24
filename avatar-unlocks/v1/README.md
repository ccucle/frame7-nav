# Windows Rainmeter 아바타에 해금 도감 연결하기

연결 키트 ZIP의 `AvatarUnlocks` 폴더를 스킨의 `@Resources`에 넣는다. INI의 마지막 섹션에서 아직 쓰지 않는 Include 번호로 아래 한 줄을 추가한다.

```ini
@Include3=#@#AvatarUnlocks\connect.inc
```

캐릭터의 이미지 미터가 `Avatar`이면 더블클릭이 자동 연결된다. 다른 이름은 `UnlockAvatarMeter`에 지정한다. 더블클릭하면 의상·펫·포켓몬 도감이 열린다. 각 탭은 3 × 3칸이고 10개부터 페이지를 넘긴다. 보유한 칸은 컬러로, 잠긴 칸은 흑백 그림과 오른쪽 위 도트 자물쇠로 보인다. 칸에 마우스를 올리면 보유 상태나 해금 조건이 표시된다. 도감 아래의 ‘업데이트 확인’에서 설치 버전을 확인하고, 새 버전이 있을 때 ‘업데이트 하기’를 누른다.

## 호스트 설정

```ini
[Variables]
Level=1
UnlockAvatar=my-avatar
UnlockProfile=player-one
UnlockCatalog=#CURRENTPATH#rewards.json
UnlockPanelX=0
UnlockPanelY=0
```

도감에 330 × 450 px 정도의 공간을 둔다. 호스트는 누적 레벨을 `Level` 또는 `UnlockLevel`로 전달한다. 접근이 중단되거나 로그아웃하면 `UnlockEnabled=0`을 전달한다. 보유·선택 파일은 스킨 루트에 아바타·프로필별로 보관한다. 기존 쓰기 가능한 폴더 경로를 끝의 역슬래시와 함께 `UnlockDataPath`로 지정할 수도 있다. ID에는 영문 소문자와 숫자, 하이픈, 밑줄을 사용한다.

## 도감과 지급 목록

포켓몬 탭은 기본형의 전국도감 번호순으로 표시한다. 상단 검색칸에 한글·영문 이름의 일부 또는 도감 번호를 입력하고 Enter를 누른다. 진화한 포켓몬을 검색하면 해당 기본형이 나온다. 잠긴 포켓몬도 눌러 진화 계열을 볼 수 있다. ‘목록으로’는 검색 결과를 유지하고, ×는 검색을 지운다.

진화 관계는 `pokedex.json`의 기본형 ID별 목록에 등록한다. 각 항목은 전국도감 번호, 영문 ID, 한글 이름, 직전 단계 번호 순서다. 첫 단계는 직전 단계 번호를 생략한다. 분기 진화는 같은 직전 단계 번호를 사용한다. 도감의 진화 정보는 보유·동행 상태를 바꾸지 않는다.

공통 도감의 이름과 그림은 미리보기다. 실제 지급은 별도로 정한 조건이 있을 때만 일어난다. 뿔둥이는 기존 트레이닝복을 첫 유효 레벨부터 받는다. 새 아바타용 키트의 기본 지급 목록은 비어 있다. 다음은 개별 아바타의 의상 보상을 등록하는 예시다.

```json
{"items":[{"id":"hoodie","kind":"outfit","level":5}]}
```

기존 도감 ID와 종류를 그대로 쓰면 해당 그림이 열린다. 새 ID에 `name`을 지정하면 그 탭에 새 칸이 생긴다. 고유 도트를 추가하기 전에는 책 아이콘을 사용한다. 공통 지급은 엔진의 `catalog`에 적고 ID가 중복되지 않게 한다. 외형·동행 연출은 호스트가 구현한다. 지급 알림은 `UnlockNewItem`과 `UnlockOnGrant`, 포켓몬 동행 선택은 `Choose('pokemon','아이템ID')`, 해제는 `Choose('pokemon')`을 사용한다. 선택된 ID는 `UnlockCompanion`에 전달된다.

## 업데이트와 배포

PC에서 한 Windows 사용자로 연결된 아바타는 공통 엔진을 공유한다. `OpenPanel()`은 도감, `OpenUpdates()`는 버전 확인, `ClosePanel()`은 창 닫기다. 새 버전이 있으면 `UnlockUpdateBubble` 그룹을 표시한다. `UnlockUpdateCode`는 최신 0, 확인 중 1, 새 버전 2, 오류 3, 설치 중 4다. 호스트는 `UnlockOnOpen`, `UnlockOnClose`로 다른 정보창이나 걷기를 조정할 수 있다.

독립 채널은 `avatar-unlocks/v1`이다. 도감 그림 원본 `gallery.png`의 64px 격자와 `gallery.json`의 아이템 순서를 맞춘다. 빌드가 두 자료를 엔진에 포함하므로 새 공통 포켓몬과 그림을 공통 업데이트로 전달할 수 있다. 인터넷이 끊겨도 번들 또는 설치된 엔진으로 도감을 연다. v1.0 키트를 사용하던 다른 호스트는 새 도감용 미터를 포함하는 연결 키트를 한 번 적용한다. 기존 뿔둥이는 본체 v0.6.7 업데이트로 이 변경을 받는다.

포켓몬 도트는 하트골드·소울실버 이미지 자료를 사용했다. 포켓몬 및 커비는 각 권리자의 캐릭터다. [PokeAPI/sprites](https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/versions/generation-iv/heartgold-soulsilver)
