# MP4 Cutter

브라우저에서 동작하는 클라이언트 사이드 영상 편집 도구입니다.  
**파일이 서버에 업로드되지 않으며**, 모든 처리는 로컬에서 완료됩니다.

🔗 **[데모 보기](https://eincl.github.io/mp4cutter/)**

---

## 기능

- **구간 자르기** — 타임라인 핸들 드래그 또는 시간 직접 입력
- **여러 파일 이어붙이기** — 블랙박스처럼 분할된 영상을 순서대로 연결 후 처리
- **오디오 제거 / 볼륨 조절** — FFmpeg 출력 볼륨과 미리보기 볼륨 동기화
- **비트레이트 조절** — 500 Kbps ~ 10 Mbps
- **해상도 조절** — 360p ~ 4K
- **예상 용량 계산** — 설정 변경 시 실시간 반영
- **재생 컨트롤** — 클릭으로 재생/일시정지, 길게 누르면 2배속

## 기술 스택

| 역할 | 사용 기술 |
|------|-----------|
| 영상 처리 | [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) (WebAssembly) |
| 빌드 | [Vite](https://vite.dev/) |
| 배포 | GitHub Pages + GitHub Actions |

서버 없이 동작하는 핵심은 FFmpeg을 WebAssembly로 컴파일한 `@ffmpeg/core`입니다.  
`@ffmpeg/ffmpeg`는 모듈 워커 문제를 피하기 위해 UMD 빌드를 `<script>` 태그로 로드합니다.

### cross-origin isolation

현재 쓰는 `@ffmpeg/core`는 **싱글스레드 빌드라 `SharedArrayBuffer`가 필요 없습니다.**
따라서 cross-origin isolation 없이도 모든 브라우저에서 동작합니다. Safari는 COI 없이도
`SharedArrayBuffer`를 노출하지만 Chrome은 감추므로, SAB를 전제로 코드를 짜면 Chrome에서만
깨집니다.

`coi-serviceworker`는 COOP/COEP 헤더를 붙일 수 없는 GitHub Pages에서 COI를 확보하기 위해
남겨둔 것으로, 멀티스레드 빌드(`@ffmpeg/core-mt`)로 전환할 때 필요합니다.

> **주의** — 이 라이브러리는 반드시 `<script src="...">`로 로드해야 합니다.
> `navigator.serviceWorker.register()`로 직접 등록하면 서비스워커 쪽 코드만 실행되고,
> 등록 직후의 `location.reload()`가 일어나지 않습니다. 서비스워커는 이미 로드된 문서에
> 헤더를 소급 적용할 수 없으므로 이 리로드가 없으면 COI가 영원히 켜지지 않습니다.
> (그래서 첫 방문 시 리로드가 한 번 일어나는 것은 정상입니다.)

## 로컬 실행

```bash
git clone https://github.com/eincl/mp4cutter.git
cd mp4cutter
npm install   # postinstall이 FFmpeg WASM 파일을 public/에 자동 복사
npm run dev
```

> `npm install` 시 `postinstall` 스크립트가 `node_modules`의 FFmpeg 관련 파일을 `public/`으로 복사합니다.  
> 이 파일들은 `.gitignore`에 포함되어 있으므로 별도 관리가 필요 없습니다.

## 배포

`main` 브랜치에 푸시하면 GitHub Actions가 자동으로 빌드 후 GitHub Pages에 배포합니다.

레포 이름이 `mp4cutter`가 아닌 경우 `.github/workflows/deploy.yml`의 `VITE_BASE_URL` 값을 수정하세요.

```yaml
VITE_BASE_URL: /your-repo-name/
```

## 개발 방식

이 프로젝트는 [Claude Code](https://claude.ai/code)와의 대화를 통해 개발되었습니다.

## 라이선스

MIT
