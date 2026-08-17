import './style.css';
import { fetchFile } from '@ffmpeg/util';

const { FFmpeg } = window.FFmpegWASM;

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  segments: [],      // [{file, duration, cumStart, objectURL}]
  totalDuration: 0,
  trimStart: 0,
  trimEnd: 0,
  dragging: null,
  segIdx: 0,
};

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const dropZone       = document.getElementById('drop-zone');
const fileInput      = document.getElementById('file-input');
const addFileInput   = document.getElementById('add-file-input');
const addFilesBtn    = document.getElementById('add-files-btn');
const editor         = document.getElementById('editor');
const preview        = document.getElementById('preview');
const videoOverlay   = document.getElementById('video-overlay');
const bigPlayIcon    = document.getElementById('big-play-icon');
const speedBadge     = document.getElementById('speed-badge');
const playerPlayBtn  = document.getElementById('player-play-btn');
const iconPlay       = document.getElementById('icon-play');
const iconPause      = document.getElementById('icon-pause');
const bigIconPlay    = document.getElementById('big-icon-play');
const bigIconPause   = document.getElementById('big-icon-pause');
const captureBtn     = document.getElementById('capture-btn');
const captureFlash   = document.getElementById('capture-flash');
const captureToast   = document.getElementById('capture-toast');
const framePrevBtn   = document.getElementById('frame-prev-btn');
const frameNextBtn   = document.getElementById('frame-next-btn');
const fileListEl     = document.getElementById('file-list');
const fileListTotal  = document.getElementById('file-list-total');
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
const estimateBar    = document.getElementById('estimate-bar');
const estimateText   = document.getElementById('estimate-text');

// ── Time formatting ────────────────────────────────────────────────────────
function formatTime(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 1000);
  return `${m}:${String(ss).padStart(2,'0')}.${String(ms).padStart(3,'0')}`;
}
function formatTimeShort(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2,'0')}`;
}
function parseTime(str) {
  str = str.trim();
  const c = str.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (c) return parseInt(c[1]) * 60 + parseInt(c[2]) + (c[3] ? parseInt(c[3].padEnd(3,'0')) / 1000 : 0);
  const n = str.match(/^(\d+(?:\.\d+)?)$/);
  return n ? parseFloat(n[1]) : null;
}
function formatFileSize(b) {
  return b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB';
}

// ── Multi-segment helpers ──────────────────────────────────────────────────
function getGlobalTime() {
  const seg = state.segments[state.segIdx];
  return seg ? seg.cumStart + preview.currentTime : 0;
}

function findSegIdx(t) {
  let idx = state.segments.findIndex((s, i) => {
    const next = state.segments[i + 1]?.cumStart ?? state.totalDuration;
    return t >= s.cumStart && t < next;
  });
  return idx === -1 ? state.segments.length - 1 : idx;
}

function seekToGlobal(t, thenPlay = false) {
  const target = Math.max(0, Math.min(t, state.totalDuration));
  const idx = findSegIdx(target);
  const seg = state.segments[idx];
  const local = target - seg.cumStart;

  if (idx !== state.segIdx) {
    state.segIdx = idx;
    preview.src = seg.objectURL;
    renderFileList();
    preview.addEventListener('loadedmetadata', () => {
      preview.currentTime = Math.min(local, preview.duration);
      if (thenPlay) preview.play().catch(() => {});
    }, { once: true });
  } else {
    preview.currentTime = Math.min(local, preview.duration);
    if (thenPlay && preview.paused) preview.play().catch(() => {});
  }
}

function rebuildCumulative() {
  let cum = 0;
  state.segments.forEach(s => { s.cumStart = cum; cum += s.duration; });
  state.totalDuration = cum;
}

// ── File list render ───────────────────────────────────────────────────────
let dragSrcIdx = null;

function renderFileList() {
  fileListEl.innerHTML = '';
  state.segments.forEach((seg, i) => {
    const div = document.createElement('div');
    div.className = 'file-entry' + (i === state.segIdx ? ' active' : '');
    div.draggable = true;
    div.innerHTML =
      `<svg class="fe-drag" viewBox="0 0 10 16" fill="currentColor">` +
        `<circle cx="3" cy="3" r="1.5"/><circle cx="7" cy="3" r="1.5"/>` +
        `<circle cx="3" cy="8" r="1.5"/><circle cx="7" cy="8" r="1.5"/>` +
        `<circle cx="3" cy="13" r="1.5"/><circle cx="7" cy="13" r="1.5"/>` +
      `</svg>` +
      `<span class="fe-idx">${i+1}</span>` +
      `<span class="fe-name" title="${seg.file.name}">${seg.file.name}</span>` +
      `<span class="fe-dur">${formatTime(seg.duration)}</span>` +
      `<span class="fe-size">${formatFileSize(seg.file.size)}</span>` +
      `<button class="fe-remove" data-idx="${i}" title="제거">×</button>`;

    // Drag reorder
    div.addEventListener('dragstart', e => {
      dragSrcIdx = i;
      setTimeout(() => div.classList.add('dragging'), 0);
      e.dataTransfer.effectAllowed = 'move';
    });
    div.addEventListener('dragend', () => {
      div.classList.remove('dragging');
      fileListEl.querySelectorAll('.file-entry').forEach(el =>
        el.classList.remove('drag-over-top', 'drag-over-bottom'));
      dragSrcIdx = null;
    });
    div.addEventListener('dragover', e => {
      e.preventDefault(); e.stopPropagation();
      fileListEl.querySelectorAll('.file-entry').forEach(el =>
        el.classList.remove('drag-over-top', 'drag-over-bottom'));
      const mid = div.getBoundingClientRect().top + div.getBoundingClientRect().height / 2;
      div.classList.add(e.clientY < mid ? 'drag-over-top' : 'drag-over-bottom');
    });
    div.addEventListener('dragleave', e => {
      if (!div.contains(e.relatedTarget))
        div.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    div.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      if (dragSrcIdx === null || dragSrcIdx === i) return;
      const mid = div.getBoundingClientRect().top + div.getBoundingClientRect().height / 2;
      const insertBefore = e.clientY < mid ? i : i + 1;
      if (insertBefore === dragSrcIdx || insertBefore === dragSrcIdx + 1) return;
      const currentSeg = state.segments[state.segIdx];
      const [moved] = state.segments.splice(dragSrcIdx, 1);
      state.segments.splice(insertBefore > dragSrcIdx ? insertBefore - 1 : insertBefore, 0, moved);
      rebuildCumulative();
      state.segIdx = state.segments.indexOf(currentSeg);
      state.trimEnd = Math.min(state.trimEnd, state.totalDuration);
      renderFileList();
      updateTimeline();
      updateEstimate();
    });

    div.addEventListener('click', e => {
      if (e.target.classList.contains('fe-remove')) {
        removeSegment(parseInt(e.target.dataset.idx));
      } else {
        seekToGlobal(seg.cumStart);
      }
    });
    fileListEl.appendChild(div);
  });
  updateFrameBtnTitles();   // 파일마다 fps가 다를 수 있다
  const totalSize = state.segments.reduce((a, s) => a + s.file.size, 0);
  fileListTotal.textContent =
    `${state.segments.length}개 파일 · ${formatTime(state.totalDuration)} · ${formatFileSize(totalSize)}`;
}

function removeSegment(idx) {
  URL.revokeObjectURL(state.segments[idx].objectURL);
  state.segments.splice(idx, 1);
  if (!state.segments.length) {
    dropZone.classList.remove('hidden');
    editor.classList.add('hidden');
    return;
  }
  rebuildCumulative();
  state.trimEnd   = Math.min(state.trimEnd,   state.totalDuration);
  state.trimStart = Math.min(state.trimStart, state.trimEnd - 0.1);
  if (state.segIdx >= state.segments.length) state.segIdx = state.segments.length - 1;
  preview.src = state.segments[state.segIdx].objectURL;
  renderFileList();
  updateTimeline();
  updateEstimate();
}

// ── Add files ──────────────────────────────────────────────────────────────
function addFiles(fileList) {
  const files = Array.from(fileList).filter(f => f.type.startsWith('video/'));
  if (!files.length) return;

  Promise.all(files.map(file => new Promise(resolve => {
    const objectURL = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = objectURL;
    v.onloadedmetadata = () => resolve({ file, duration: v.duration, cumStart: 0, objectURL, frameDur: null });
    v.onerror = ()       => resolve({ file, duration: 0,           cumStart: 0, objectURL, frameDur: null });
  }))).then(newSegs => {
    const seen = new Set(state.segments.map(s => s.file.name));
    const merged = [
      ...state.segments,
      ...newSegs.filter(s => !seen.has(s.file.name)),
    ];
    merged.sort((a, b) => a.file.name.localeCompare(b.file.name));

    state.segments = merged;
    state.segIdx   = 0;
    rebuildCumulative();
    state.trimStart = 0;
    state.trimEnd   = state.totalDuration;

    preview.src = state.segments[0].objectURL;
    preview.addEventListener('loadedmetadata', () => {
      renderFileList();
      updateTimeline();
      updatePlayhead();
      updatePlayPauseUI();
      dropZone.classList.add('hidden');
      editor.classList.remove('hidden');
      // 프레임 간격 측정은 화면을 막지 않도록 에디터를 띄운 뒤에 돌린다
      state.segments.forEach(measureFrameDuration);
    }, { once: true });
  });
}

// ── Frame duration 측정 ────────────────────────────────────────────────────
// 브라우저는 fps를 알려주지 않는다. requestVideoFrameCallback으로 실제 프레임이
// 표시되는 간격(mediaTime 차이)을 재서 정확한 한 프레임 크기를 구한다.
// 프레임이 드롭되면 간격이 배수로 벌어지므로 최솟값을 쓴다.
const FRAME_DUR_FALLBACK = 1 / 30;
const MEASURE_SAMPLES = 12;
const MEASURE_TIMEOUT = 2000;

function measureFrameDuration(seg) {
  if (seg.frameDur || seg.measuring) return;
  const probe = document.createElement('video');
  if (!('requestVideoFrameCallback' in probe)) return;
  seg.measuring = true;

  let prev = null, minDelta = Infinity, samples = 0, done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    probe.pause();
    probe.removeAttribute('src');
    probe.load();          // 디코더 해제
    seg.measuring = false;
    if (minDelta !== Infinity && minDelta > 0.001) {
      seg.frameDur = minDelta;
      updateFrameBtnTitles();
    }
  };

  probe.src = seg.objectURL;
  probe.muted = true;      // muted라 사용자 제스처 없이도 재생된다
  probe.playsInline = true;
  probe.requestVideoFrameCallback(function tick(_, md) {
    if (prev !== null) {
      const d = md.mediaTime - prev;
      if (d > 0.001) { minDelta = Math.min(minDelta, d); samples++; }
    }
    prev = md.mediaTime;
    if (samples >= MEASURE_SAMPLES) return finish();
    probe.requestVideoFrameCallback(tick);
  });
  probe.play().catch(finish);
  const timer = setTimeout(finish, MEASURE_TIMEOUT);
}

function currentFrameDur() {
  return state.segments[state.segIdx]?.frameDur || FRAME_DUR_FALLBACK;
}

function updateFrameBtnTitles() {
  const seg = state.segments[state.segIdx];
  const fps = seg?.frameDur ? `${(1 / seg.frameDur).toFixed(2)}fps` : '30fps 가정';
  framePrevBtn.title = `이전 프레임 (← / Shift+← 1초) · ${fps}`;
  frameNextBtn.title = `다음 프레임 (→ / Shift+→ 1초) · ${fps}`;
}

// ── Estimated output size ─────────────────────────────────────────────────
function updateEstimate() {
  if (!state.segments.length || !state.totalDuration) return;
  const trimDur    = state.trimEnd - state.trimStart;
  const totalSize  = state.segments.reduce((a, s) => a + s.file.size, 0);
  const AUDIO_BPS  = 128_000;
  const origBps    = (totalSize * 8) / state.totalDuration;
  let videoBps     = Math.max(origBps - AUDIO_BPS, 0);

  if (bitrateSelect.value) {
    videoBps = parseInt(bitrateSelect.value) * 1000;
  } else if (resolutionSelect.value && preview.videoWidth && preview.videoHeight) {
    const [w, h] = resolutionSelect.value.split(':').map(Number);
    videoBps = videoBps * (w * h) / (preview.videoWidth * preview.videoHeight);
  }

  const audioBps  = muteAudio.checked ? 0 : AUDIO_BPS;
  const estBytes  = (videoBps + audioBps) * trimDur / 8;
  const refBytes  = totalSize * (trimDur / state.totalDuration);
  const pct       = Math.round((estBytes / refBytes) * 100) - 100;
  const cls       = pct > 0 ? 'estimate-up' : 'estimate-down';

  estimateText.innerHTML =
    `길이 <span class="estimate-val">${formatTimeShort(trimDur)}</span>` +
    ` &nbsp;→&nbsp; 예상 용량 <span class="estimate-val">${formatFileSize(estBytes)}</span>` +
    ` <span class="${cls}">(${pct > 0 ? '+' : ''}${pct}%)</span>`;
  estimateBar.classList.remove('hidden');
}

// ── Timeline helpers ───────────────────────────────────────────────────────
function posToTime(x) {
  const rect = timelineTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (x - rect.left) / rect.width)) * state.totalDuration;
}
function timeToFrac(t) {
  return state.totalDuration > 0 ? t / state.totalDuration : 0;
}

function updateTimeline() {
  const sf = timeToFrac(state.trimStart);
  const ef = timeToFrac(state.trimEnd);
  handleStart.style.left  = `${sf * 100}%`;
  handleEnd.style.left    = `${ef * 100}%`;
  trimRegion.style.left   = `${sf * 100}%`;
  trimRegion.style.width  = `${(ef - sf) * 100}%`;
  labelStart.textContent  = formatTime(state.trimStart);
  labelEnd.textContent    = formatTime(state.trimEnd);
  trimStartInput.value    = formatTime(state.trimStart);
  trimEndInput.value      = formatTime(state.trimEnd);
  trimDuration.textContent = `선택 구간: ${formatTime(state.trimEnd - state.trimStart)}`;
  updateEstimate();

  // 현재 위치가 범위 밖이면 보정
  const now = getGlobalTime();
  if      (now < state.trimStart) seekToGlobal(state.trimStart);
  else if (now > state.trimEnd)   seekToGlobal(state.trimEnd);
}

function updatePlayhead() {
  const g = getGlobalTime();
  playhead.style.left = `${timeToFrac(g) * 100}%`;
  labelCurrent.textContent = formatTime(g);
}

function updatePlayPauseUI() {
  const playing = !preview.paused;
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
}

function flashOverlay(willPlay) {
  bigIconPlay.classList.toggle('hidden', !willPlay);
  bigIconPause.classList.toggle('hidden', willPlay);
  bigPlayIcon.classList.remove('flash');
  void bigPlayIcon.offsetWidth; // reflow to restart animation
  bigPlayIcon.classList.add('flash');
  bigPlayIcon.addEventListener('animationend', () => bigPlayIcon.classList.remove('flash'), { once: true });
}

// ── Drag & drop ────────────────────────────────────────────────────────────
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => { e.preventDefault(); dropZone.classList.remove('drag-over'); addFiles(e.dataTransfer.files); });
fileInput.addEventListener('change', () => addFiles(fileInput.files));
addFilesBtn.addEventListener('click', () => addFileInput.click());
addFileInput.addEventListener('change', () => addFiles(addFileInput.files));

// 에디터 영역에도 드래그&드롭 허용
editor.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); });
editor.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); addFiles(e.dataTransfer.files); });

// ── Video events ───────────────────────────────────────────────────────────
preview.addEventListener('timeupdate', () => {
  updatePlayhead();
  if (!preview.paused && getGlobalTime() >= state.trimEnd) {
    preview.pause();
    const local = state.trimEnd - state.segments[state.segIdx].cumStart;
    preview.currentTime = Math.min(local, preview.duration);
  }
});
preview.addEventListener('play',   updatePlayPauseUI);
preview.addEventListener('pause',  updatePlayPauseUI);
preview.addEventListener('ended', () => {
  const nextIdx  = state.segIdx + 1;
  const segEnd   = state.segments[state.segIdx].cumStart + state.segments[state.segIdx].duration;
  if (nextIdx < state.segments.length && segEnd < state.trimEnd - 0.01) {
    seekToGlobal(state.segments[nextIdx].cumStart, true);
  } else {
    updatePlayPauseUI();
  }
});

// ── Player controls ────────────────────────────────────────────────────────
function togglePlay() {
  const willPlay = preview.paused;
  flashOverlay(willPlay);
  if (!willPlay) { preview.pause(); return; }
  const now = getGlobalTime();
  if (now < state.trimStart || now >= state.trimEnd) {
    seekToGlobal(state.trimStart, true);
  } else {
    preview.play().catch(() => {});
  }
}

playerPlayBtn.addEventListener('click', togglePlay);

// ── Frame capture (사진 저장) ──────────────────────────────────────────────
let toastTimer = null;
function showToast(msg) {
  captureToast.textContent = msg;
  captureToast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => captureToast.classList.add('hidden'), 2200);
}

function stampForName(t) {
  const m  = Math.floor(t / 60);
  const s  = Math.floor(t % 60);
  const ms = Math.floor((t % 1) * 1000);
  return `${m}m${String(s).padStart(2,'0')}s${String(ms).padStart(3,'0')}`;
}

function captureFrame() {
  const seg = state.segments[state.segIdx];
  // readyState < HAVE_CURRENT_DATA면 그릴 프레임이 아직 없다
  if (!seg || preview.readyState < 2 || !preview.videoWidth) return;

  // 화면 크기가 아닌 원본 해상도로 캡쳐한다 (번호판 판독용)
  const canvas = document.createElement('canvas');
  canvas.width  = preview.videoWidth;
  canvas.height = preview.videoHeight;
  canvas.getContext('2d').drawImage(preview, 0, 0, canvas.width, canvas.height);

  const base = seg.file.name.replace(/\.[^.]+$/, '');
  const name = `${base}_${stampForName(preview.currentTime)}.png`;

  canvas.toBlob(blob => {
    if (!blob) { showToast('캡쳐 실패'); return; }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    showToast(`캡쳐 저장됨 · ${canvas.width}×${canvas.height}`);
  }, 'image/png');   // 번호판 판독을 위해 무손실 PNG

  captureFlash.classList.remove('flash');
  void captureFlash.offsetWidth; // reflow to restart animation
  captureFlash.classList.add('flash');
}

function stepFrame(dir, seconds = null) {
  if (!state.segments.length) return;
  if (!preview.paused) preview.pause();
  const t = getGlobalTime() + dir * (seconds ?? currentFrameDur());
  seekToGlobal(Math.max(state.trimStart, Math.min(t, state.trimEnd)));
}

captureBtn.addEventListener('click', captureFrame);
framePrevBtn.addEventListener('click', () => stepFrame(-1));
frameNextBtn.addEventListener('click', () => stepFrame(1));

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  else if (e.code === 'KeyC' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); captureFrame(); }
  else if (e.code === 'ArrowLeft')  { e.preventDefault(); stepFrame(-1, e.shiftKey ? 1 : null); }
  else if (e.code === 'ArrowRight') { e.preventDefault(); stepFrame( 1, e.shiftKey ? 1 : null); }
});

// ── Timeline click / drag ──────────────────────────────────────────────────
timelineTrack.addEventListener('click', e => {
  if (state.dragging) return;
  const t = posToTime(e.clientX);
  seekToGlobal(Math.max(state.trimStart, Math.min(t, state.trimEnd)));
});

function onHandleDown(e, which) { e.preventDefault(); e.stopPropagation(); state.dragging = which; }
handleStart.addEventListener('mousedown',  e => onHandleDown(e, 'start'));
handleEnd.addEventListener('mousedown',    e => onHandleDown(e, 'end'));
handleStart.addEventListener('touchstart', e => onHandleDown(e, 'start'), { passive: false });
handleEnd.addEventListener('touchstart',   e => onHandleDown(e, 'end'),   { passive: false });

const getClientX = e => e.touches ? e.touches[0].clientX : e.clientX;
document.addEventListener('mousemove', onDragMove);
document.addEventListener('touchmove', onDragMove, { passive: false });
document.addEventListener('mouseup',  () => { state.dragging = null; });
document.addEventListener('touchend', () => { state.dragging = null; });

function onDragMove(e) {
  if (!state.dragging) return;
  e.preventDefault();
  const t = posToTime(getClientX(e));
  if (state.dragging === 'start') {
    state.trimStart = Math.max(0, Math.min(t, state.trimEnd - 0.1));
  } else {
    state.trimEnd = Math.min(state.totalDuration, Math.max(t, state.trimStart + 0.1));
  }
  updateTimeline();
}

// ── "현재↗" buttons ────────────────────────────────────────────────────────
document.querySelectorAll('.set-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = getGlobalTime();
    if (btn.dataset.target === 'start') state.trimStart = Math.min(t, state.trimEnd - 0.1);
    else                                state.trimEnd   = Math.max(t, state.trimStart + 0.1);
    updateTimeline();
  });
});

// ── Manual time inputs ─────────────────────────────────────────────────────
trimStartInput.addEventListener('change', () => {
  const t = parseTime(trimStartInput.value);
  if (t !== null && t >= 0 && t < state.trimEnd) { state.trimStart = t; updateTimeline(); }
  else trimStartInput.value = formatTime(state.trimStart);
});
trimEndInput.addEventListener('change', () => {
  const t = parseTime(trimEndInput.value);
  if (t !== null && t > state.trimStart && t <= state.totalDuration) { state.trimEnd = t; updateTimeline(); }
  else trimEndInput.value = formatTime(state.trimEnd);
});

// ── Volume ─────────────────────────────────────────────────────────────────
function setVolume(pct) {
  const v = Math.max(0, Math.min(200, pct));
  preview.volume = Math.min(v / 100, 1);
  preview.muted  = v === 0;
  volumeSlider.value = v;
  volumeValue.textContent = v + '%';
}
muteAudio.addEventListener('change', () => {
  volumeRow.classList.toggle('disabled', muteAudio.checked);
  preview.muted = muteAudio.checked;
  updateEstimate();
});
volumeSlider.addEventListener('input', () => setVolume(parseInt(volumeSlider.value)));
bitrateSelect.addEventListener('change', updateEstimate);
resolutionSelect.addEventListener('change', updateEstimate);

// ── Video overlay (click + hold 2x) ───────────────────────────────────────
let holdTimer = null, isHolding = false;
videoOverlay.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  holdTimer = setTimeout(() => {
    isHolding = true; preview.playbackRate = 2;
    speedBadge.classList.remove('hidden');
    if (preview.paused) preview.play().catch(() => {});
  }, 300);
});
videoOverlay.addEventListener('click', () => { if (!isHolding) togglePlay(); });
function stopHold() {
  if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  if (isHolding) { isHolding = false; preview.playbackRate = 1; speedBadge.classList.add('hidden'); }
}
videoOverlay.addEventListener('mouseup', stopHold);
videoOverlay.addEventListener('mouseleave', stopHold);
videoOverlay.addEventListener('touchstart', () => {
  holdTimer = setTimeout(() => {
    isHolding = true; preview.playbackRate = 2;
    speedBadge.classList.remove('hidden');
    if (preview.paused) preview.play().catch(() => {});
  }, 300);
}, { passive: true });
videoOverlay.addEventListener('touchend', () => { if (!isHolding) togglePlay(); stopHold(); }, { passive: true });

// ── FFmpeg ─────────────────────────────────────────────────────────────────
ffmpeg.on('log', ({ message }) => console.log('[ffmpeg]', message));
ffmpeg.on('progress', ({ progress }) => {
  const pct = Math.round(Math.min(progress, 1) * 100);
  progressFill.style.width = pct + '%';
  progressText.textContent = `처리 중... ${pct}%`;
});

async function ensureFFmpeg() {
  if (ffmpegLoaded) return;
  // @ffmpeg/core는 싱글스레드 빌드라 SharedArrayBuffer가 없어도 동작한다.
  // (core-mt로 바꾸는 경우에만 cross-origin isolation이 필수)
  if (!window.crossOriginIsolated)
    console.warn('[ffmpeg] cross-origin isolated 아님 — 싱글스레드로 동작합니다.');
  const base = import.meta.env.BASE_URL, origin = window.location.origin;
  await ffmpeg.load({
    coreURL: `${origin}${base}ffmpeg-core.js`,
    wasmURL: `${origin}${base}ffmpeg-core.wasm`,
  });
  ffmpegLoaded = true;
}

processBtn.addEventListener('click', async () => {
  if (!state.segments.length) return;
  processBtn.disabled = true;
  progressSection.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressText.textContent = 'FFmpeg 로딩 중...';

  try {
    await ensureFFmpeg();

    const doTrim      = state.trimStart > 0.01 || state.trimEnd < state.totalDuration - 0.01;
    const doVolume    = !muteAudio.checked && parseInt(volumeSlider.value) !== 100;
    const doBitrate   = bitrateSelect.value !== '';
    const doRes       = resolutionSelect.value !== '';
    const needReencode = doVolume || doBitrate || doRes;
    const exts        = state.segments.map(s => s.file.name.split('.').pop() || 'mp4');

    // Write input files
    for (let i = 0; i < state.segments.length; i++) {
      progressText.textContent = `파일 읽는 중... (${i+1}/${state.segments.length})`;
      await ffmpeg.writeFile(`input${i}.${exts[i]}`, await fetchFile(state.segments[i].file));
    }

    const args = [];

    if (state.segments.length === 1) {
      if (doTrim) args.push('-ss', state.trimStart.toFixed(3));
      args.push('-i', `input0.${exts[0]}`);
      if (doTrim) args.push('-t', (state.trimEnd - state.trimStart).toFixed(3));
    } else {
      // 멀티파일: concat demuxer
      const list = state.segments.map((_, i) => `file 'input${i}.${exts[i]}'`).join('\n');
      await ffmpeg.writeFile('concat.txt', new TextEncoder().encode(list));
      if (doTrim) args.push('-ss', state.trimStart.toFixed(3));
      args.push('-f', 'concat', '-safe', '0', '-i', 'concat.txt');
      if (doTrim) args.push('-t', (state.trimEnd - state.trimStart).toFixed(3));
    }

    if (muteAudio.checked) {
      args.push('-an');
    } else if (doVolume) {
      args.push('-af', `volume=${(parseInt(volumeSlider.value) / 100).toFixed(2)}`);
    }
    if (doRes)     args.push('-vf', `scale=${resolutionSelect.value}:flags=lanczos`);
    if (doBitrate) args.push('-b:v', bitrateSelect.value);
    if (!needReencode) args.push('-c', muteAudio.checked ? 'copy' : 'copy');

    args.push('-y', 'output.mp4');

    progressText.textContent = '처리 중... 0%';
    await ffmpeg.exec(args);

    progressText.textContent = '파일 준비 중...';
    const data = await ffmpeg.readFile('output.mp4');
    const url  = URL.createObjectURL(new Blob([data], { type: 'video/mp4' }));
    const a    = document.createElement('a');
    a.href     = url;
    a.download = (state.segments.length > 1 ? state.segments[0].file.name.replace(/\.[^.]+$/, '') + '_concat' : state.segments[0].file.name.replace(/\.[^.]+$/, '')) + '_edited.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Chrome은 다운로드가 blob을 다 읽기 전에 revoke하면 중단시킨다. 큰 파일도
    // 안전하도록 넉넉히 미룬다 (탭을 닫으면 어차피 함께 해제된다).
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    progressFill.style.width = '100%';
    progressText.textContent = '완료! 다운로드가 시작됩니다.';

    for (let i = 0; i < state.segments.length; i++) await ffmpeg.deleteFile(`input${i}.${exts[i]}`).catch(() => {});
    if (state.segments.length > 1) await ffmpeg.deleteFile('concat.txt').catch(() => {});
    await ffmpeg.deleteFile('output.mp4').catch(() => {});
  } catch (err) {
    console.error(err);
    progressText.textContent = '오류: ' + (err?.message || String(err));
    progressFill.style.width = '0%';
  } finally {
    processBtn.disabled = false;
  }
});
