const PREFIX = "hitsterexp:";
const PACKS_FILE = "songs/packs.json";
const SELECTED_PACKS_KEY = "hitsterexp:selected-packs";
const TURN_TRANSITION_MS = 600;
const PHONE_FLIP_THRESHOLD = 50;
const TURN_FALLBACK_MS = 4500;

const screens = {
  home: document.getElementById("screen-home"),
  options: document.getElementById("screen-options"),
  packInfo: document.getElementById("screen-pack-info"),
  scanner: document.getElementById("screen-scanner"),
  turn: document.getElementById("screen-turn"),
  resolve: document.getElementById("screen-resolve")
};

const brandHitster = document.getElementById("brand-hitster");
const playNowButton = document.getElementById("play-now-button");
const playNowLabel = document.getElementById("play-now-label");
const optionsButton = document.getElementById("options-button");
const optionsCloseButton = document.getElementById("options-close-button");
const saveOptionsButton = document.getElementById("save-options-button");
const packsList = document.getElementById("packs-list");
const packInfoBackButton = document.getElementById("pack-info-back-button");
const startScanButton = document.getElementById("start-scan-button");
const selectedYears = document.getElementById("selected-years");
const selectedSets = document.getElementById("selected-sets");
const scannerCloseButton = document.getElementById("scanner-close-button");
const scannerFrame = document.getElementById("scanner-frame");
const scannerStatus = document.getElementById("scanner-status");
const scannerError = document.getElementById("scanner-error");
const turnPhone = document.getElementById("turn-phone");
const turnSensorError = document.getElementById("turn-sensor-error");
const turnSensorRetryButton = document.getElementById("turn-sensor-retry-button");
const nextCardButton = document.getElementById("next-card-button");
const nextCardLabel = document.getElementById("next-card-label");
const resolvePreviewBar = document.getElementById("resolve-preview-bar");
const resolveStopButton = document.getElementById("resolve-stop-button");
const resolveArtist = document.getElementById("resolve-artist");
const resolveYear = document.getElementById("resolve-year");
const resolveTitle = document.getElementById("resolve-title");
const collabIndicator = document.getElementById("collab-indicator");
const spotifyAutoplayHost = document.getElementById("spotify-autoplay-host");

let scanner = null;
let isScanning = false;
let activeSong = null;
let turnAnimationTimer = null;
let turnFallbackTimer = null;
let waitingForFlip = false;
let orientationSignalSeen = false;
let spotifyController = null;
let pendingSpotifyUri = null;
let fitRaf = 0;
let scannerFoundTimer = 0;
let packs = [];
let selectedPackFiles = [];
let songPool = new Map();

window.addEventListener("resize", () => {
  scheduleTextFit();
});

window.onSpotifyIframeApiReady = (IFrameAPI) => {
  IFrameAPI.createController(
    spotifyAutoplayHost,
    {
      uri: "spotify:track:3AhXZa8sUQht0UEdBJgpGc",
      width: "1",
      height: "1"
    },
    (controller) => {
      spotifyController = controller;
      if (pendingSpotifyUri) {
        startSpotifyPreview(pendingSpotifyUri);
      }
    }
  );
};

playNowButton.addEventListener("click", async () => {
  try {
    await prepareSelectedPacks();
    renderPackInfo();
    showScreen("packInfo");
  } catch (error) {
    alert(error.message || "Nie udało się wczytać rozszerzeń.");
  }
});

optionsButton.addEventListener("click", async () => {
  try {
    await loadPacks();
    renderOptions();
    showScreen("options");
  } catch (error) {
    alert(error.message || "Nie udało się wczytać rozszerzeń.");
  }
});

optionsCloseButton.addEventListener("click", () => {
  showScreen("home");
});

saveOptionsButton.addEventListener("click", async () => {
  selectedPackFiles = getCheckedPackFiles();
  if (!selectedPackFiles.length && packs.length) {
    selectedPackFiles = [packs[0].file];
  }
  localStorage.setItem(SELECTED_PACKS_KEY, JSON.stringify(selectedPackFiles));
  await prepareSelectedPacks(true);
  showScreen("home");
});

packInfoBackButton.addEventListener("click", () => {
  showScreen("home");
});

startScanButton.addEventListener("click", async () => {
  activateSpotifyElement();
  if (isMobileDevice() && !(await ensureOrientationAccess())) {
    alert("Czujnik ruchu jest wymagany na telefonie. Włącz go i spróbuj ponownie.");
    return;
  }
  await openScanner();
});

turnSensorRetryButton.addEventListener("click", async () => {
  if (await ensureOrientationAccess()) {
    showTurnScreen();
  } else {
    showTurnSensorError();
  }
});

scannerCloseButton.addEventListener("click", async () => {
  await stopScanner();
  showScreen("home");
});

nextCardButton.addEventListener("click", async () => {
  resetResolveView();
  await openScanner();
});

resolveStopButton.addEventListener("click", () => {
  stopSpotifyPreview();
});

window.addEventListener("deviceorientation", (event) => {
  if (!waitingForFlip) {
    return;
  }

  orientationSignalSeen = true;
  const beta = Math.abs(event.beta || 0);
  const gamma = Math.abs(event.gamma || 0);
  if (beta < PHONE_FLIP_THRESHOLD && gamma < PHONE_FLIP_THRESHOLD) {
    return;
  }

  finishTurnFlow();
});

window.addEventListener("orientationchange", () => {
  if (!waitingForFlip) {
    return;
  }

  if (isScreenUpsideDown()) {
    finishTurnFlow();
  }
});

if (window.screen?.orientation?.addEventListener) {
  window.screen.orientation.addEventListener("change", () => {
    if (!waitingForFlip) {
      return;
    }

    if (isScreenUpsideDown()) {
      finishTurnFlow();
    }
  });
}

async function openScanner() {
  showScreen("scanner");
  showScannerError("");
  scannerStatus.textContent = "Nakieruj aparat na kod QR.";
  await startScanner();
}

async function startScanner() {
  if (isScanning) {
    return;
  }

  if (!window.Html5Qrcode) {
    showScannerError("Biblioteka skanera nie zaladowala sie poprawnie.");
    return;
  }

  scanner = scanner || new Html5Qrcode("reader");

  try {
    await scanner.start(
      { facingMode: "environment" },
      { fps: 10 },
      onScanSuccess,
      () => {}
    );
    isScanning = true;
  } catch (error) {
    showScannerError(`Nie udalo sie uruchomic kamery: ${error.message || error}`);
  }
}

async function stopScanner() {
  if (!scanner || !isScanning) {
    return;
  }

  await scanner.stop();
  await scanner.clear();
  isScanning = false;
}

async function onScanSuccess(decodedText) {
  const qrCodeId = parseQrCodeId(decodedText);
  if (!qrCodeId) {
    showScannerError(`Nieznany kod: ${decodedText}`);
    return;
  }

  scannerStatus.textContent = `Szukam utworu ${qrCodeId}...`;
  showScannerError("");
  flashScannerFound();

  try {
    const song = await fetchSong(qrCodeId);
    activeSong = song;
    await pause(180);
    await stopScanner();
    showTurnScreen();
  } catch (error) {
    showScannerError(error.message || "Nie udało sie pobrać utworu.");
  }
}

function parseQrCodeId(value) {
  const trimmed = (value || "").trim();
  if (!trimmed.toLowerCase().startsWith(PREFIX)) {
    return "";
  }

  return trimmed.slice(PREFIX.length).trim();
}

async function fetchSong(qrCodeId) {
  await prepareSelectedPacks();
  const songs = songPool.get(qrCodeId);
  if (!songs?.length) {
    throw new Error("Zeskanuj Inna karte!");
  }

  return songs[Math.floor(Math.random() * songs.length)];
}

async function loadPacks() {
  if (packs.length) {
    return;
  }

  const response = await fetch(PACKS_FILE);
  if (!response.ok) {
    throw new Error("Nie udało się wczytać listy rozszerzeń.");
  }

  packs = await response.json();
  if (!Array.isArray(packs)) {
    packs = [packs];
  }

  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(SELECTED_PACKS_KEY) || "null");
  } catch (_) {
    localStorage.removeItem(SELECTED_PACKS_KEY);
  }
  selectedPackFiles = Array.isArray(saved) && saved.length ? saved : packs.map((pack) => pack.file);
}

async function prepareSelectedPacks(force = false) {
  if (!packs.length) {
    await loadPacks();
  }

  if (songPool.size && !force) {
    return;
  }

  songPool = new Map();
  const selectedPacks = packs.filter((pack) => selectedPackFiles.includes(pack.file));
  await Promise.all(selectedPacks.map(loadPackSongs));
}

async function loadPackSongs(pack) {
  const response = await fetch(`songs/${pack.file}`);
  if (!response.ok) {
    throw new Error(`Nie udało się wczytać ${pack.file}.`);
  }

  const cards = await response.json();
  cards.forEach((card) => {
    const existing = songPool.get(card.qr_code_id) || [];
    songPool.set(card.qr_code_id, existing.concat(card.songs || []));
  });
}

function renderOptions() {
  packsList.innerHTML = "";
  packs.forEach((pack) => {
    const label = document.createElement("label");
    label.className = "pack-option";

    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = pack.file;
    input.checked = selectedPackFiles.includes(pack.file);

    const copy = document.createElement("span");
    copy.innerHTML = `<strong>${pack.name}</strong><small>${pack.description || ""}</small>`;

    label.append(input, copy);
    packsList.append(label);
  });
}

function getCheckedPackFiles() {
  return [...packsList.querySelectorAll("input:checked")].map((input) => input.value);
}

function renderPackInfo() {
  const selectedPacks = packs.filter((pack) => selectedPackFiles.includes(pack.file));
  const minYear = Math.min(...selectedPacks.map((pack) => pack.years_min));
  const maxYear = Math.max(...selectedPacks.map((pack) => pack.years_max));
  const sets = [...new Set(selectedPacks.flatMap((pack) => pack.set || []))].sort();

  selectedYears.textContent = Number.isFinite(minYear) && Number.isFinite(maxYear) ? `${minYear}-${maxYear}` : "-";
  selectedSets.innerHTML = "";
  sets.forEach((set) => {
    const swatch = document.createElement("span");
    swatch.className = `set-swatch set-${set}`;
    swatch.textContent = set;
    selectedSets.append(swatch);
  });
}

function showTurnScreen() {
  if (!activeSong) {
    return;
  }

  showScreen("turn");
  waitingForFlip = true;
  orientationSignalSeen = false;
  clearTurnSensorError();
  clearTurnAnimation();
  turnPhone.classList.remove("turn-phone-active");
  turnAnimationTimer = window.setTimeout(() => {
    turnPhone.classList.add("turn-phone-active");
  }, TURN_TRANSITION_MS);
  turnFallbackTimer = window.setTimeout(() => {
    if (!waitingForFlip) {
      return;
    }

    if (!isMobileDevice()) {
      finishTurnFlow();
    } else if (!orientationSignalSeen) {
      showTurnSensorError();
    }
  }, TURN_FALLBACK_MS);
}

function renderResolve() {
  if (!activeSong) {
    showScreen("home");
    return;
  }

  showScreen("resolve");
  resolveArtist.textContent = activeSong.artist || "";
  resolveYear.textContent = activeSong.year || "";
  resolveTitle.textContent = activeSong.title || "";
  resolvePreviewBar.classList.add("hidden");

  if (isCollaboration(activeSong.collab)) {
    collabIndicator.classList.remove("hidden");
  } else {
    collabIndicator.classList.add("hidden");
  }

  if (activeSong.spotify_id) {
    resolvePreviewBar.classList.remove("hidden");
    startSpotifyPreview(`spotify:track:${activeSong.spotify_id}`);
  } else {
    stopSpotifyPreview();
  }

  scheduleTextFit();
}

function resetResolveView() {
  activeSong = null;
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  stopSpotifyPreview();
  clearTurnSensorError();
  resolvePreviewBar.classList.add("hidden");
  collabIndicator.classList.add("hidden");
}

function clearTurnAnimation() {
  if (turnAnimationTimer) {
    window.clearTimeout(turnAnimationTimer);
    turnAnimationTimer = null;
  }
  turnPhone.classList.remove("turn-phone-active");
}

function clearTurnFallback() {
  if (turnFallbackTimer) {
    window.clearTimeout(turnFallbackTimer);
    turnFallbackTimer = null;
  }
}

function showScannerError(message) {
  if (!message) {
    scannerError.textContent = "";
    scannerError.classList.add("hidden");
    return;
  }

  scannerError.textContent = message;
  scannerError.classList.remove("hidden");
}

function showScreen(name) {
  Object.entries(screens).forEach(([key, element]) => {
    element.classList.toggle("hidden", key !== name);
  });

  scheduleTextFit();
}

function isCollaboration(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true";
}

function isMobileDevice() {
  if (navigator.userAgentData?.mobile === true) {
    return true;
  }

  return /Android|iPhone|iPad|iPod|IEMobile|Windows Phone/i.test(navigator.userAgent);
}

async function ensureOrientationAccess() {
  if (typeof window.DeviceOrientationEvent === "undefined") {
    return false;
  }

  if (typeof window.DeviceOrientationEvent.requestPermission !== "function") {
    return "ondeviceorientation" in window;
  }

  try {
    return (await window.DeviceOrientationEvent.requestPermission()) === "granted";
  } catch (_) {
    return false;
  }
}

function showTurnSensorError() {
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  turnSensorError.classList.remove("hidden");
  turnSensorRetryButton.classList.remove("hidden");
}

function clearTurnSensorError() {
  turnSensorError.classList.add("hidden");
  turnSensorRetryButton.classList.add("hidden");
}

function finishTurnFlow() {
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  clearTurnSensorError();
  renderResolve();
}

function isScreenUpsideDown() {
  const angle =
    typeof window.screen?.orientation?.angle === "number"
      ? window.screen.orientation.angle
      : typeof window.orientation === "number"
        ? window.orientation
        : null;

  if (angle === null) {
    return false;
  }

  const normalized = ((angle % 360) + 360) % 360;
  return normalized === 180;
}

function startSpotifyPreview(uri) {
  pendingSpotifyUri = uri;
  if (!spotifyController) {
    return;
  }

  activateSpotifyElement();
  spotifyController.loadUri(uri);
  const playResult = spotifyController.play?.();
  if (playResult && typeof playResult.catch === "function") {
    playResult.catch(() => {});
  }
}

function stopSpotifyPreview() {
  pendingSpotifyUri = null;
  if (!spotifyController) {
    return;
  }

  const pauseResult = spotifyController.pause?.();
  if (pauseResult && typeof pauseResult.catch === "function") {
    pauseResult.catch(() => {});
  }
}

function activateSpotifyElement() {
  if (!spotifyController || typeof spotifyController.activateElement !== "function") {
    return;
  }

  try {
    spotifyController.activateElement();
  } catch (_) {
    // Ignore activation failures and still try normal playback.
  }
}

function flashScannerFound() {
  if (!scannerFrame) {
    return;
  }

  if (scannerFoundTimer) {
    window.clearTimeout(scannerFoundTimer);
  }

  scannerFrame.classList.add("scanner-frame-found");
  scannerFoundTimer = window.setTimeout(() => {
    scannerFrame.classList.remove("scanner-frame-found");
    scannerFoundTimer = 0;
  }, 320);
}

function pause(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function scheduleTextFit() {
  if (fitRaf) {
    window.cancelAnimationFrame(fitRaf);
  }

  fitRaf = window.requestAnimationFrame(() => {
    fitRaf = 0;
    applyTextFit();
  });
}

function applyTextFit() {
  if (typeof window.textFit !== "function") {
    return;
  }

  fitSingleLine(brandHitster, { minFontSize: 24, maxFontSize: 180 });
  fitSingleLine(playNowLabel, { minFontSize: 18, maxFontSize: 72 });
  fitSingleLine(nextCardLabel, { minFontSize: 16, maxFontSize: 64 });

  if (!screens.resolve.classList.contains("hidden")) {
    fitTwoLines(resolveArtist, { minFontSize: 10, maxFontSize: 84 });
    fitTwoLines(resolveTitle, { minFontSize: 10, maxFontSize: 84 });
    fitSingleLine(resolveYear, { minFontSize: 28, maxFontSize: 160 });
  }
}

function fitSingleLine(element, options = {}) {
  if (!element || !isVisibleForFit(element)) {
    return;
  }

  window.textFit(element, {
    widthOnly: true,
    multiLine: false,
    detectMultiLine: false,
    reProcess: true,
    ...options
  });
}

function fitTwoLines(element, options = {}) {
  if (!element || !isVisibleForFit(element)) {
    return;
  }

  window.textFit(element, {
    widthOnly: false,
    multiLine: true,
    detectMultiLine: true,
    reProcess: true,
    ...options
  });
}

function isVisibleForFit(element) {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

scheduleTextFit();

if (document.fonts?.ready) {
  document.fonts.ready.then(scheduleTextFit);
}
