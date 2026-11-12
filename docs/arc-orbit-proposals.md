# Arc에서 참고한 Orbit 개선 제안

2026년 11월 12일 기준으로 Arc는 12월 22일에 서비스를 종료할 예정입니다. Arc Search iOS의 기본 브라우징은 이어지고, Android판은 같은 날 내려갈 예정입니다. Arc의 데스크톱과 모바일에서 내보내는 형식이 다르므로 가져오기는 각각의 실제 파일로 검증해야 합니다.
[Arc 종료 일정](https://resources.arc.net/hc/en-us/articles/44412972248471-Arc-Sunset-Key-Dates-and-What-to-Expect) · [Arc 내보내기 안내](https://resources.arc.net/hc/en-us/articles/25583851606039-How-Do-I-Export-My-Data-from-Arc)

## 1. 브라우저를 바꿔도 탭 구조를 이어 쓰기

Arc 데스크톱에서 내보낸 스페이스·고정 탭·폴더 목록과 Arc Search의 열린 링크 내보내기를 각각 가져오는 흐름을 추가합니다. 파일을 열면 가져올 스페이스, 폴더, 탭 수와 중복 주소를 먼저 보여줍니다. 이름, 원래 순서와 폴더 소속을 유지하고 같은 파일을 다시 가져와도 중복을 피합니다. 종료 일정이 있으므로 후속 항목 중 먼저 개발할 기능입니다.
[Arc 내보내기 안내](https://resources.arc.net/hc/en-us/articles/25583851606039-How-Do-I-Export-My-Data-from-Arc) · [Arc Search 내보내기](https://resources.arc.net/hc/en-us/articles/25482329571479-Arc-for-iOS-Android-Arc-Search)

## 2. 즐겨찾기와 탭을 같은 곳에서 다루기

즐겨찾기는 아이콘 그리드, 고정 탭은 제목이 있는 행, 그룹은 접을 수 있는 색상 카드로 표시합니다. 이번 작업에 포함된 배치에 이어 드래그로 그룹 사이 이동, 즐겨찾기 순서 편집, 마지막으로 사용한 탭 순서 전환을 추가합니다. 모바일에서는 길게 누르기와 화면 읽기 프로그램으로도 같은 작업을 할 수 있어야 합니다.
[Arc Search Android 조작과 탭 전환](https://resources.arc.net/hc/en-us/articles/27306904379031-Arc-Search-for-Android-Release-Notes)

## 3. 링크를 잠깐 열고 원래 작업으로 돌아가기

Arc의 Peek과 Little Arc를 참고해 링크 길게 누르기 또는 우클릭에서 미리보기를 엽니다. 미리보기에서 기존 탭으로 돌아가거나 현재 스페이스의 새 탭, 분할 화면으로 전환할 수 있게 합니다. 링크를 열 때의 스페이스와 로그인 상태를 유지하고, 뒤로가기는 미리보기를 먼저 닫도록 합니다.
[Arc 기능별 전환 안내](https://resources.arc.net/hc/en-us/articles/44413577819159-Arc-Sunset-Frequently-Asked-Questions)

## 4. 탭 정리와 복원에 제어권 주기

스페이스별로 일반 탭을 자동 보관하는 기간을 선택하고, 정리 직후 실행 취소를 제공합니다. 고정 탭과 사용 중인 분할 탭은 자동 보관 대상에서 제외합니다. 보관함에서 제목, 주소와 스페이스로 검색하고 다시 열면 기존 그룹에 들어가도록 합니다. 앱을 오래 열어 두거나 재시작하는 경우에도 규칙이 한 번씩 적용되도록 검증합니다.
[Arc의 탭과 스페이스 구조](https://resources.arc.net/hc/en-us/articles/44413577819159-Arc-Sunset-Frequently-Asked-Questions)

## 5. 기기 사이에서 설정과 링크 이어 쓰기

현재의 꾸미기 파일과 링크 내보내기를 바탕으로 Android와 Windows에서 스페이스 이름, 그룹, 고정 탭, 즐겨찾기를 먼저 옮길 수 있게 합니다. 동기화는 파일 왕복과 중복 병합을 검증한 뒤 선택형으로 설계합니다. 쿠키와 로그인 자격 증명은 기기별 보호 방식과 복구 설계가 마련되기 전까지 현재의 기기별 저장 정책을 적용합니다.
[Arc에서 Dia로 옮기는 데이터](https://resources.arc.net/hc/en-us/articles/44413129117591-Move-from-Arc-to-Dia)
