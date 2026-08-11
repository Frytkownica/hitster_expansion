const PREFIX = "hitsterexp:";
const TURN_TRANSITION_MS = 1300;
const PHONE_FLIP_THRESHOLD = 150;
const TURN_FALLBACK_MS = 4500;

const config = window.HITSTER_CONFIG || {};
const supabaseClient =
  config.supabaseUrl && config.supabasePublishableKey
    ? window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey)
    : null;

const screens = {
  home: document.getElementById("screen-home"),
  scanner: document.getElementById("screen-scanner"),
  turn: document.getElementById("screen-turn"),
  resolve: document.getElementById("screen-resolve")
};

const brandHitster = document.getElementById("brand-hitster");
const playNowButton = document.getElementById("play-now-button");
const playNowLabel = document.getElementById("play-now-label");
const scannerCloseButton = document.getElementById("scanner-close-button");
const scannerStatus = document.getElementById("scanner-status");
const scannerError = document.getElementById("scanner-error");
const turnPhone = document.getElementById("turn-phone");
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
let orientationAccessRequested = false;
let lastOrientationEventAt = 0;
let spotifyController = null;
let pendingSpotifyUri = null;
let fitRaf = 0;

if (!supabaseClient) {
  showScannerError("Brakuje konfiguracji Supabase.");
}

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
  activateSpotifyElement();
  await ensureOrientationAccess();
  openScanner();
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
  lastOrientationEventAt = Date.now();
  if (!waitingForFlip) {
    return;
  }

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
  if (!supabaseClient) {
    showScreen("scanner");
    showScannerError("Brakuje konfiguracji Supabase.");
    return;
  }

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

  try {
    const song = await fetchSong(qrCodeId);
    activeSong = song;
    await stopScanner();
    showTurnScreen();
  } catch (error) {
    showScannerError(error.message || "Nie udalo sie pobrac utworu.");
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
  const { data, error } = await supabaseClient
    .from("hitster")
    .select("*")
    .eq("qr_code_id", qrCodeId)
    .maybeSingle();

  if (error) {
    throw new Error(`Blad Supabase: ${error.message}`);
  }

  if (!data) {
    throw new Error(`Nie znaleziono utworu dla qr_code_id ${qrCodeId}.`);
  }

  return data;
}

function showTurnScreen() {
  if (!activeSong) {
    return;
  }

  showScreen("turn");
  waitingForFlip = true;
  clearTurnAnimation();
  turnPhone.classList.remove("turn-phone-active");
  turnAnimationTimer = window.setTimeout(() => {
    turnPhone.classList.add("turn-phone-active");
  }, TURN_TRANSITION_MS);
  turnFallbackTimer = window.setTimeout(() => {
    if (!waitingForFlip) {
      return;
    }

    if (!lastOrientationEventAt && !supportsScreenOrientationSignal()) {
      finishTurnFlow();
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

async function ensureOrientationAccess() {
  if (orientationAccessRequested) {
    return;
  }

  orientationAccessRequested = true;

  try {
    if (typeof DeviceOrientationEvent?.requestPermission === "function") {
      await DeviceOrientationEvent.requestPermission();
    }
  } catch (_) {
    // If the browser rejects the prompt path, we still keep fallback signals.
  }
}

function finishTurnFlow() {
  waitingForFlip = false;
  clearTurnAnimation();
  clearTurnFallback();
  renderResolve();
}

function supportsScreenOrientationSignal() {
  return typeof window.orientation === "number" || typeof window.screen?.orientation?.angle === "number";
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
