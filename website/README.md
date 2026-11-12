# Orbit 소개 사이트

[orbit.intro-us.xyz](https://orbit.intro-us.xyz/)를 Cloudflare Worker의 Custom Domain으로 배포합니다. 소개 페이지의 설치 파일과 SHA-256 링크는 Orbit의 공개 GitHub 릴리스를 가리킵니다. 버전은 저장소의 `package.json`에서 가져옵니다.

- `node build.mjs`로 소개 사이트의 정적 파일을 `dist`에 준비합니다. Orbit 로고와 남산 배경은 브라우저와 같은 원본을 사용합니다.
- `deploy.cmd -CheckOnly`로 빌드와 배포 설정을 검사합니다.
- Windows에서 Cloudflare Wrangler에 로그인한 상태로 `deploy.cmd`를 실행하면 운영 사이트에 배포합니다. 계정에는 Orbit Worker와 `intro-us.xyz` 영역의 Workers Routes 쓰기 권한이 필요합니다.
