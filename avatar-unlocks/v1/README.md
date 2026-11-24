# Windows Rainmeter 아바타 연결

배포한 `connect-kit.zip`의 AvatarUnlocks 폴더를 새 스킨의 `@Resources`에 넣고, 스킨의 `[Rainmeter]`에 다음 항목을 추가한다. 이미 사용 중인 번호가 있으면 다음 빈 Include 번호를 사용한다.

```ini
@Include3=#@#AvatarUnlocks\connect.inc
```

바인딩은 호스트의 `Level` 변수를 읽는다. 한 PC에서 연결한 스킨들은 같은 해금 엔진을 읽고, 기본 보유·동행 파일은 스킨별 루트에 저장한다. 호스트에서 프로필을 바꾸려면 `UnlockProfile`을 별도로 지정한다. 프로필과 아바타 ID에는 영문 소문자, 숫자, 하이픈, 밑줄을 사용한다. 사용자가 여럿이면 로그인에 따라 고유 프로필을 지정하고 로그아웃 시 `UnlockEnabled=0`을 전달한다.

모든 아바타에 배포할 보상은 해금 엔진의 `catalog`에 등록한다. 공통 업데이트 한 번으로 연결된 아바타가 새 목록을 읽는다. 한 아바타에만 추가할 보상은 전용 카탈로그에 다른 ID로 등록한다. 첫 배포의 두 목록은 비어 있다. 커스텀 파일은 업데이트 폴더 밖에 저장한다. 다음은 시험용 설정이다.

```ini
[Variables]
Level=1
UnlockAvatar=my-avatar
UnlockProfile=player-one
UnlockCatalog=#CURRENTPATH#rewards.json
```

```json
{"items":[{"id":"sample-friend","kind":"pokemon","level":2}]}
```

보상 지급 후 새 ID는 `UnlockNewItem`으로 전달된다. 선택적으로 `UnlockOnGrant`에 호스트의 알림 동작을 지정한다. 아바타의 이미지 미터 이름이 `Avatar`이면 연결할 때 더블클릭 동작이 자동으로 지정된다. 다른 이름이면 `UnlockAvatarMeter`에 그 이름을 지정한다. 더블클릭하면 전용 창에서 설치 버전과 배포 버전을 확인한다. 새 버전이 있을 때만 ‘업데이트 하기’, 확인에 실패하면 ‘다시 확인’이 보인다. 동작을 직접 연결할 때는 `[!CommandMeasure AvatarUnlocks OpenPanel()]`을 사용한다. `UnlockUpdateCode` 값은 최신 0, 확인 중 1, 새 버전 2, 오류 3, 설치 중 4다.

동료 선택은 `[!CommandMeasure AvatarUnlocks "Choose('pokemon','sample-friend')"]`, 돌려보내기는 `[!CommandMeasure AvatarUnlocks "Choose('pokemon')"]`을 사용한다. 호스트가 `UnlockCompanion` 값을 해당 캐릭터의 도트와 걷기 동작에 연결한다. 다른 종류도 같은 방식으로 개별 보유·선택을 저장한다.

독립 배포 채널은 `avatar-unlocks/v1`이다. 새 엔진 파일을 넣고 서명된 feed를 함께 게시한다. 갱신한 버전은 Windows 사용자별 공용 폴더에 설치된다. 기존 스킨과 보유 기록은 각각 자신의 위치에서 읽는다. 인터넷에 연결할 수 없으면 기존 설치본 또는 키트에 포함된 엔진으로 동작한다.

기본 연결 키트에는 새 버전이 있을 때 나타나는 ‘해금 업데이트 해줘’ 알림과 전용 창이 들어 있다. 알림을 눌러도 같은 창이 열린다. 창은 약 179 × 120 px다. `UnlockPanelX`와 `UnlockPanelY`로 스킨 안의 위치를 지정할 수 있다. 다른 미터와 겹치면 연결 include를 스킨의 마지막 섹션에 두고, 고정 크기 스킨은 창이 보일 공간을 확보한다. `UnlockOnOpen`과 `UnlockOnClose`로 다른 정보창이나 걷기 동작을 조정할 수 있다. 해금 엔진과 공통 목록이 독립 업데이트 대상이다. 새 도트와 동행 연출은 각 스킨에서 지원해야 한다.
