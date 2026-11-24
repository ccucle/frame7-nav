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
UnlockPanelX=0
UnlockPanelY=0
```

도감에 330 × 450 px 정도의 공간을 둔다. 호스트는 누적 레벨을 `Level` 또는 `UnlockLevel`로 전달한다. 접근이 중단되거나 로그아웃하면 `UnlockEnabled=0`을 전달한다. 보유·선택 파일은 스킨 루트에 아바타·프로필별로 보관한다. 기존 쓰기 가능한 폴더 경로를 끝의 역슬래시와 함께 `UnlockDataPath`로 지정할 수도 있다. ID에는 영문 소문자와 숫자, 하이픈, 밑줄을 사용한다.

## 도감과 지급 목록

포켓몬 탭은 각 종을 독립된 카드로 표시한다. 기본형과 진화체 31종이 각자의 전국도감 번호순으로 정렬된다. 한 페이지에 최대 아홉 종이 보인다. 파이리·리자드·리자몽은 각각 #0004·#0005·#0006이고, 피카츄 #0025는 피츄 #0172보다 앞에 온다. 잠긴 진화체의 카드를 열면 해당 종의 돌 조건을 바로 확인하며, 보유한 종은 꺼낼 수 있다.

검색바를 눌러 한글 이름·영문 ID의 일부 또는 정확한 도감 번호를 입력한다. Enter로 입력을 끝내거나 바깥을 클릭한 뒤 검색바를 다시 누르면 이전 검색어가 선택된다. ×는 전체 목록을 복원하고 상세의 ‘목록으로’는 페이지와 검색 결과를 유지한다. 도트 버튼의 녹색은 선택 또는 보유, 금색은 실행 가능한 진화를 나타낸다.

진화체 앞모습 그림은 [PokeAPI/sprites](https://github.com/PokeAPI/sprites)에서 가져왔다. 하트골드·소울실버에 등장한 21종은 해당 버전, 님피아는 X·Y 그림을 사용했다. 카드 원본은 `gallery.png`의 가로 아홉 칸짜리 64×64 타일이다. `gallery.json`에 [ID, 한글 이름, 타일 번호]를 적고 27~35번 줄은 UI용으로 비운다. `pokedex.json`에 등록한 모든 종에 고유한 그림 칸과 도감 번호가 있어야 빌드할 수 있다. 버튼 스타일은 `buttons.lua`, 실시간 검색과 입력창 재사용은 `gallery.lua`와 `search.ps1`에서 관리한다.

진화 관계는 `pokedex.json`의 기본형 ID별 목록에 등록한다. 각 항목은 전국도감 번호, 영문 ID, 한글 이름, 직전 단계 번호 순서다. 첫 단계는 직전 단계 번호를 생략한다. 분기 진화는 같은 직전 단계 번호를 사용한다. 도감의 진화 정보는 보유·동행 상태를 바꾸지 않는다.

뿔둥이는 첫 유효 레벨에 트레이닝복을, Lv.2에 이상해씨·파이리·꼬부기를 한 번씩 받는다. 새 아바타의 기본 지급 목록은 비어 있다. 호스트 전용 보상을 추가하려면 아래 JSON을 스킨 폴더의 rewards.json에 저장하고 변수에 `UnlockCatalog=#CURRENTPATH#rewards.json`을 지정한다.

```json
{"items":[{"id":"hoodie","kind":"outfit","level":5}]}
```

기존 도감 ID와 종류를 그대로 쓰면 해당 그림이 열린다. 새 ID에 `name`을 지정하면 그 탭에 새 칸이 생긴다. 고유 도트를 추가하기 전에는 책 아이콘을 사용한다. 공통 지급은 엔진의 `catalog`에 적고 ID가 중복되지 않게 한다. 외형·동행 연출은 호스트가 구현한다. 지급 알림은 `UnlockNewItem`과 `UnlockOnGrant`, 포켓몬 동행 선택은 `Choose('pokemon','아이템ID')`, 해제는 `Choose('pokemon')`을 사용한다. 선택된 ID는 `UnlockCompanion`에 전달된다.

## 업데이트와 배포

PC에서 한 Windows 사용자로 연결된 아바타는 공통 엔진을 공유한다. `OpenPanel()`은 도감, `OpenUpdates()`는 버전 확인, `ClosePanel()`은 창 닫기다. 새 버전이 있으면 `UnlockUpdateBubble` 그룹을 표시한다. `UnlockUpdateCode`는 최신 0, 확인 중 1, 새 버전 2, 오류 3, 설치 중 4다. 호스트는 `UnlockOnOpen`, `UnlockOnClose`로 다른 정보창이나 걷기를 조정할 수 있다.

뿔둥이 외형·기본 동작·Formday 연결은 본체 채널 `buddy`에서 관리한다. 의상·펫·포켓몬 목록, 도감 그림, 진화·크기, 아바타별 보상과 도감 표시는 공통 채널 `avatar-unlocks/v1`에서 배포한다. 뿔둥이를 더블클릭하고 ‘업데이트 확인’ → ‘업데이트 하기’를 누른다.

공통 소스는 `AvatarUnlocks` 폴더에 있다. 세 종류의 카드와 그림은 `gallery.json`과 `gallery.png`, 포켓몬 정보는 `pokedex.json`과 `pokemon-sizes.json`, 아바타별 지급은 `avatar-rewards.json`에서 편집한다. 같은 ID가 이전 호스트 지급표에도 있으면 도감의 지급 레벨을 적용하고 기존 보유 기록을 이어 쓴다. 뿔둥이 지급표의 키는 `formday-buddy`다. 새 아바타는 자신의 고유 `UnlockAvatar`를 사용한다.

도감 배포 시 `engine.lua`의 헤더와 `M.version`을 함께 올린다. `python work/package_skin.py unlock-release`와 `python work/package_skin.py unlock-kit`로 빌드하고, 기존 발행 계정에서 채널 `avatar-unlocks/v1`을 지정해 서명한다. 버전 Lua, 피드, 연결 키트를 함께 배포한다. 서명된 Lua가 도감 데이터·그림과 기존 도감 미터를 구동하는 코드를 전달한다. 새 아바타는 최신 키트를 한 번 연결한 뒤 같은 도감 업데이트를 받는다.

포켓몬 도트는 하트골드·소울실버 이미지 자료를 사용했다. 포켓몬 및 커비는 각 권리자의 캐릭터다. [PokeAPI/sprites](https://github.com/PokeAPI/sprites/tree/master/sprites/pokemon/versions/generation-iv/heartgold-soulsilver)

## 포켓몬 걷기와 동행

포켓몬 탭에서 보유한 종의 카드를 열고 **꺼내기**를 누르면 도감이 닫히고 그 포켓몬이 아바타 곁에 나타난다. 같은 카드의 **돌려보내기**로 동행을 끝낸다. 실제 화면상의 가로 이동 거리에 맞춰 네 프레임을 순환하고, 방향 전환에는 반대쪽 그림을 사용하며 멈추면 대기 프레임을 표시한다. 동행 선택은 아바타·프로필별로 저장한다.

전국도감 번호순으로 이상해씨·파이리·꼬부기·식스테일·고라파덕·야돈·코일·이브이·피츄의 좌우 걷기 그림이 들어 있다. 뿔둥이의 현재 지급 조건은 Lv.2의 이상해씨·파이리·꼬부기다. 새로 제작하는 종은 정지 카드와 걷기 그림을 각각 확인한다. 도감 카드는 Pokémon Database의 하트골드·소울실버 일반색 앞모습을 기준으로 하고, 걷기는 아래 종별 기준을 따른다. [카드 기준](https://pokemondb.net/sprites) · [필드 동행 도트 출처](https://github.com/teobz/pkmn-hgss-animated-overworld-sprites/tree/5295a3bc935aabb56b2958bede509e6f36f77dfe)

바탕화면 동행 배율은 `pokemon-sizes.json`에서 작음 3배, 중간 4배, 큼 5배로 지정한다. 이상해씨의 동행 그림은 Pokémon Ranger의 일반색으로 제작했다. 이 종의 24픽셀 높이 걷기를 기존 작음 크기에 맞추기 위해 `referenceHeight`를 16으로 두며 표시 영역은 56×48픽셀이다. 다른 여덟 종은 기존 동행 그림을 사용한다. [이상해씨 원본 시트 · Ragey](https://www.spriters-resource.com/ds_dsi/pokemonranger/asset/8452/) 도감 카드의 그림 크기는 별도로 관리한다. 제작용 Python 환경에는 Pillow를 설치한다. 패키징할 때 정수 배율인 종은 실제 표시 크기에 맞춰 최근접 이웃 확대한 그림을 넣는다. 소수 배율은 최대 배율에서 축소한다.

걷기 그림은 `walk-atlas.png`에 32×32 픽셀 네 프레임을 가로로 배치하고 종마다 왼쪽·오른쪽 두 줄을 쓴다. `walk-rows.json`에는 같은 순서로 고유 ID와 여덟 프레임의 도트를 모두 감싸는 `crop` 영역을 적는다. 값은 프레임 안의 왼쪽·위쪽 좌표와 가로·세로 길이다. 같은 영역을 모든 프레임에 적용해 확대해도 발걸음이 흔들리지 않게 한다. 작음은 화면 왼쪽 발끝 앞에 살짝 겹치고 중간은 오른쪽 몸통 옆에 붙는다. 큼은 오른쪽 뒤에서 아바타에 일부 가려진다. 도감이 열리면 동행을 숨기고 아바타·배지·패널 위치를 복원한다. 새 호스트는 아바타보다 앞선 선언 위치에 빈 Image 미터 `UnlockFollowerBack`을 두면 의상을 포함한 실제 아바타 뒤에 큰 동행을 그릴 수 있다. 뿔둥이는 기존 CompactBounds를 사용한다. 별도 이름은 UnlockFollowerBackMeter, 아바타와 함께 이동할 미터 목록은 UnlockFollowerAnchorMeters로 지정한다. `UnlockFollowerFootInset`은 아바타 그림의 아래쪽 투명 여백이며 뿔둥이는 3픽셀이다. 호스트의 `UnlockAvatarMeter`(기본값 `Avatar`)로 실제 위치와 크기를 읽는다. 도감이 닫힌 동안 첫 카드 그림 미터와 검색 타이머를 동행에 사용하므로 기존에 설치된 아바타도 도감 업데이트에서 새 모션을 받는다.

## 스톤 파우더와 진화

뿔둥이 v0.6.15의 우클릭 정보창에서 파우더 아이콘 옆의 보유량을 확인한다. **[제작하기]**를 누른 뒤 원하는 돌 옆의 **[제작]**을 누르면 파우더 30개가 돌 1개로 바뀐다. 제작창에서 각 돌의 현재 보유량을 볼 수 있다. 기록 연결이 끊기면 저장된 잔액을 표시하고 제작을 잠근다.

처음 연결할 때 읽은 누적 XP를 포함해 1 XP마다 5개를 지급한다. 이미 지급한 최고 누적 XP를 보관한다. 원본 기록 수정으로 XP가 줄어들면 그 최고치를 다시 넘긴 부분부터 지급한다. 레벨 조건은 기본형에 적용한다. 도감에서 원하는 진화체의 카드를 열고 **진화**를 누른다. 이전 형태를 보유해야 하며, 기본형에서 한 단계는 돌 1개, 다음 단계는 돌 2개가 필요하다. 분기는 각각 독립이고 이미 해금한 종은 계속 선택할 수 있다.

팀은 `stones.json`의 돌별 `targets`에 대상 ID를 한 번 등록하고 `pokedex.json`에 바로 이전 종의 도감 번호를 적는다. 비용은 빌드 시 직전 종에서 깊이를 계산한다. 새로운 계열은 크기표·걷기 그림·행 목록에도 등록한다. 모든 기본형과 진화체에 동행 그림이 있는지 패키징 시 검사한다. 도감 갱신은 `engine.lua`의 헤더 및 버전, 우클릭·제작창 갱신은 뿔둥이 본체 버전을 올린다. 두 화면이 모두 바뀌면 함께 배포한다.

돌의 그림과 이름은 제작창에서 같은 순서로 배치한다. `stones.json` 순서를 바꾸면 `DesktopSkin/@Resources/stone-items.png`의 각 24픽셀 칸 순서도 맞춘다. 맨 왼쪽 칸은 파우더다. 저장은 호스트의 `UnlockDataPath` 아래 `unlock~아바타~프로필~wallet-일련번호.txn`으로 한다. 지급, 제작, 진화마다 한 파일을 확정하고 지출과 결과를 함께 복원한다. 백업은 기존 보유·선택 파일과 같은 Data 폴더 단위로 진행한다.

아이템 그림은 [PokeAPI/sprites](https://github.com/PokeAPI/sprites/tree/master/sprites/items)에서 가져왔고 스톤 파우더에는 별의모래 그림을 썼다. 1~4세대 진화체에는 위 하트골드·소울실버 필드 그림을 썼다. 님피아 걷기는 [baronessfaron의 SpriteCollab 그림](https://github.com/PMDCollab/SpriteCollab/tree/master/sprite/0700)이며 [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/)으로 제공된다. 좌우 방향을 골라 32픽셀 칸에 맞추고 다른 포켓몬과 한 이미지에 배치했다.
