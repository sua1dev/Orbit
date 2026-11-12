# Orbit Mobile 0.1.0-alpha.1

Orbit의 Android용 첫 개발 빌드입니다. Android 10(API 29) 이상에서 실행하며, 기기에 설치된 Android System WebView를 사용합니다.

- 하단 주소창에서 URL을 열거나 Google, 네이버, DuckDuckGo로 검색합니다.
- 하단 탭 버튼에서 카드를 가로로 넘기고, 제목과 주소로 검색하고, 닫은 탭을 복원합니다. 탭 버튼을 길게 누르면 검색창과 함께 새 탭이 열립니다. 하단 도구 모음을 가로로 밀어서 열린 탭 사이를 이동할 수 있습니다.
- 시작 페이지는 서울 시각에 맞춰 낮과 밤을 전환합니다. 설정에서 낮·밤·비·눈 사진과 테마를 선택할 수 있습니다.
- 페이지 메뉴에서 즐겨찾기, 주소 복사, Android 공유, 앞뒤 탐색, 새로고침을 사용할 수 있습니다. 링크를 길게 누르면 새 탭에서 열 수 있습니다.
- 일반 탭의 주소와 즐겨찾기, WebView의 영구 쿠키와 사이트 데이터는 기기에 저장됩니다. Android 기본 앱 설정에서 Orbit을 웹 링크를 여는 브라우저로 선택할 수 있습니다.

이 빌드는 테스트용 디버그 키로 서명합니다. 데스크톱 동기화, 실시간 날씨, 시크릿 모드는 모바일 초판의 범위 밖입니다. 앱을 다시 시작하면 각 탭의 마지막 주소가 복원됩니다. 뒤로·앞으로 탐색은 메모리에 남아 있는 탭에서 이어집니다. 일부 사이트의 Google 로그인, 권한 요청, DRM, 로그인 쿠키가 필요한 다운로드는 WebView 환경에서 제한될 수 있습니다.

## 빌드

JDK 17 이상과 Android SDK Platform 36을 설치하고 Android Studio에서 `mobile` 폴더를 엽니다. Windows에서는 같은 폴더에서 다음 명령을 실행할 수 있습니다.

```powershell
.\gradlew.bat :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
```

APK는 `app/build/outputs/apk/debug/app-debug.apk`에 생성됩니다. Gradle은 저장소의 `renderer`에서 Orbit 아이콘, 사이트 아이콘과 배경 이미지를 복사합니다.
