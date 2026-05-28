import './style.css';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  file: null,
  duration: 0,
  trimStart: 0,
  trimEnd: 0,
  dragging: null, // 'start' | 'end' | null
};

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const editor         = document.getElementById('editor');
const preview        = document.getElementById('preview');
const fileInfo       = document.getElementById('file-info');
const timelineTrack  = document.getElementById('timeline-track');
const playhead       = document.getElementById('playhead');
const trimRegion     = document.getElementById('trim-region');
const handleStart    = document.getElementById('handle-start');
const handleEnd      = document.getElementById('handle-end');
const labelStart     = document.getElementById('label-start');
const labelEnd       = document.getElementById('label-end');
const labelCurrent   = document.getElementById('label-current');
const trimStartInput = document.getElementById('trim-start-input');
const trimEndInput   = document.getElementById('trim-end-input');
const trimDuration   = document.getElementById('trim-duration');
const muteAudio      = document.getElementById('mute-audio');
const volumeRow      = document.getElementById('volume-row');
const volumeSlider   = document.getElementById('volume-slider');
const volumeValue    = document.getElementById('volume-value');
const bitrateSelect  = document.getElementById('bitrate-select');
const resolutionSelect = document.getElementById('resolution-select');
const processBtn     = document.getElementById('process-btn');
const progressSection = document.getElementById('progress-section');
const progressFill   = document.getElementById('progress-fill');
const progressText   = document.getElementById('progress-text');

// ── Time formatting ────────────────────────────────────────────────────────
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function parseTime(str) {
  // Accepts: "1:23.456", "83.456", "1:23", "83"
  str = str.trim();
  const colonMatch = str.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (colonMatch) {
    const m = parseInt(colonMatch[1]);
    const s = parseInt(colonMatch[2]);
    const ms = colonMatch[3] ? parseInt(colonMatch[3].padEnd(3, '0')) : 0;
    return m * 60 + s + ms / 1000;
  }
  const numMatch = str.match(/^(\d+(?:\.\d+)?)$/);
  if (numMatch) return parseFloat(numMatch[1]);
  return null;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Timeline helpers ───────────────────────────────────────────────────────
function posToTime(x) {
  const rect = timelineTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
  return frac * state.duration;
}

function timeToFrac(t) {
  return state.duration > 0 ? t / state.duration : 0;
}

function updateTimeline() {
  const startFrac = timeToFrac(state.trimStart);
  const endFrac   = timeToFrac(state.trimEnd);

  handleStart.style.left = `${startFrac * 100}%`;
  handleEnd.style.left   = `${endFrac * 100}%`;
  trimRegion.style.left  = `${startFrac * 100}%`;
  trimRegion.style.width = `${(endFrac - startFrac) * 100}%`;

  labelStart.textContent = formatTime(state.trimStart);
  labelEnd.textContent   = formatTime(state.trimEnd);

  trimStartInput.value = formatTime(state.trimStart);
  trimEndInput.value   = formatTime(state.trimEnd);

  const dur = state.trimEnd - state.trimStart;
  trimDuration.textContent = `선택 구간: ${formatTime(dur)}`;
}

function updatePlayhead() {
  const frac = timeToFrac(preview.currentTime);
  playhead.style.left = `${frac * 100}%`;
  labelCurrent.textContent = formatTime(preview.currentTime);
}

// ── File load ──────────────────────────────────────────────────────────────
function loadFile(file) {
  if (!file || !file.type.startsWith('video/')) return;
  state.file = file;

  const url = URL.createObjectURL(file);
  preview.src = url;

  preview.onloadedmetadata = () => {
    state.duration = preview.duration;
    state.trimStart = 0;
    state.trimEnd = state.duration;

    fileInfo.innerHTML = `
      <span><strong>${file.name}</strong></span>
      <span>크기: <strong>${formatFileSize(file.size)}</strong></span>
      <span>길이: <strong>${formatTime(state.duration)}</strong></span>
      <span>해상도: <strong>${preview.videoWidth}×${preview.videoHeight}</strong></span>
    `;

    updateTimeline();
    updatePlayhead();

    dropZone.classList.add('hidden');
    editor.classList.remove('hidden');
  };
}

// ── Drag & drop ────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  loadFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));

// ── Video events ───────────────────────────────────────────────────────────
preview.addEventListener('timeupdate', updatePlayhead);

// Click on timeline to seek
timelineTrack.addEventListener('click', (e) => {
  if (state.dragging) return;
  preview.currentTime = posToTime(e.clientX);
});

// ── Timeline drag handles ──────────────────────────────────────────────────
function onHandleMouseDown(e, which) {
  e.preventDefault();
  e.stopPropagation();
  state.dragging = which;
}

handleStart.addEventListener('mousedown', (e) => onHandleMouseDown(e, 'start'));
handleEnd.addEventListener('mousedown',   (e) => onHandleMouseDown(e, 'end'));
handleStart.addEventListener('touchstart', (e) => { onHandleMouseDown(e, 'start'); }, { passive: false });
handleEnd.addEventListener('touchstart',   (e) => { onHandleMouseDown(e, 'end'); }, { passive: false });

function getClientX(e) {
  return e.touches ? e.touches[0].clientX : e.clientX;
}

document.addEventListener('mousemove', (e) => onDragMove(e));
document.addEventListener('touchmove', (e) => onDragMove(e), { passive: false });
document.addEventListener('mouseup',   () => { state.dragging = null; });
document.addEventListener('touchend',  () => { state.dragging = null; });

function onDragMove(e) {
  if (!state.dragging) return;
  e.preventDefault();
  const t = posToTime(getClientX(e));
  if (state.dragging === 'start') {
    state.trimStart = Math.max(0, Math.min(t, state.trimEnd - 0.1));
  } else {
    state.trimEnd = Math.min(state.duration, Math.max(t, state.trimStart + 0.1));
  }
  updateTimeline();
}

// ── "현재↗" set-time buttons ───────────────────────────────────────────────
document.querySelectorAll('.set-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const t = preview.currentTime;
    if (target === 'start') {
      state.trimStart = Math.min(t, state.trimEnd - 0.1);
    } else {
      state.trimEnd = Math.max(t, state.trimStart + 0.1);
    }
    updateTimeline();
  });
});

// ── Manual time inputs ─────────────────────────────────────────────────────
trimStartInput.addEventListener('change', () => {
  const t = parseTime(trimStartInput.value);
  if (t !== null && t >= 0 && t < state.trimEnd) {
    state.trimStart = t;
    updateTimeline();
  } else {
    trimStartInput.value = formatTime(state.trimStart);
  }
});

trimEndInput.addEventListener('change', () => {
  const t = parseTime(trimEndInput.value);
  if (t !== null && t > state.trimStart && t <= state.duration) {
    state.trimEnd = t;
    updateTimeline();
  } else {
    trimEndInput.value = formatTime(state.trimEnd);
  }
});

// ── Audio controls ─────────────────────────────────────────────────────────
muteAudio.addEventListener('change', () => {
  volumeRow.classList.toggle('disabled', muteAudio.checked);
});

volumeSlider.addEventListener('input', () => {
  volumeValue.textContent = volumeSlider.value + '%';
});

// ── FFmpeg load ────────────────────────────────────────────────────────────
async function ensureFFmpeg() {
  if (ffmpegLoaded) return;
  const base = import.meta.env.BASE_URL;
  ffmpeg.on('log', ({ message }) => console.log('[ffmpeg]', message));
  ffmpeg.on('progress', ({ progress }) => {
    const pct = Math.round(Math.min(progress, 1) * 100);
    progressFill.style.width = pct + '%';
    progressText.textContent = `처리 중... ${pct}%`;
  });
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${base}ffmpeg-core.wasm`, 'application/wasm'),
  });
  ffmpegLoaded = true;
}

// ── Process ────────────────────────────────────────────────────────────────
processBtn.addEventListener('click', async () => {
  if (!state.file) return;

  processBtn.disabled = true;
  progressSection.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'FFmpeg 로딩 중...';

  try {
    await ensureFFmpeg();
    progressText.textContent = '파일 읽는 중...';

    const inputName = 'input.' + (state.file.name.split('.').pop() || 'mp4');
    await ffmpeg.writeFile(inputName, await fetchFile(state.file));

    const args = [];
    const doTrim = state.trimStart > 0.01 || state.trimEnd < state.duration - 0.01;
    const doVolume = !muteAudio.checked && parseInt(volumeSlider.value) !== 100;
    const doBitrate = bitrateSelect.value !== '';
    const doRes = resolutionSelect.value !== '';
    const needReencode = doVolume || doBitrate || doRes;

    // Input-side seek for fast trim
    if (doTrim) {
      args.push('-ss', state.trimStart.toFixed(3));
    }
    args.push('-i', inputName);
    if (doTrim) {
      args.push('-t', (state.trimEnd - state.trimStart).toFixed(3));
    }

    // Audio
    if (muteAudio.checked) {
      args.push('-an');
    } else if (doVolume) {
      args.push('-af', `volume=${(parseInt(volumeSlider.value) / 100).toFixed(2)}`);
    }

    // Video filters
    const vfilters = [];
    if (doRes) {
      vfilters.push(`scale=${resolutionSelect.value}:flags=lanczos`);
    }

    if (vfilters.length > 0) {
      args.push('-vf', vfilters.join(','));
    }

    if (doBitrate) {
      args.push('-b:v', bitrateSelect.value);
    }

    // Codec: copy if no re-encode needed, otherwise let ffmpeg choose
    if (!needReencode) {
      if (!muteAudio.checked) args.push('-c', 'copy');
      else args.push('-c:v', 'copy');
    }

    args.push('-y', 'output.mp4');

    progressText.textContent = '처리 중... 0%';
    await ffmpeg.exec(args);

    progressText.textContent = '파일 준비 중...';
    const data = await ffmpeg.readFile('output.mp4');
    const blob = new Blob([data.buffer], { type: 'video/mp4' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const baseName = state.file.name.replace(/\.[^.]+$/, '');
    a.download = `${baseName}_edited.mp4`;
    a.click();
    URL.revokeObjectURL(url);

    progressFill.style.width = '100%';
    progressText.textContent = '완료! 다운로드가 시작됩니다.';

    // Cleanup ffmpeg FS
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
  } catch (err) {
    console.error(err);
    progressText.textContent = '오류: ' + err.message;
  } finally {
    processBtn.disabled = false;
  }
});
