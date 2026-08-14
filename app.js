(() => {
"use strict";

const $ = (id) => document.getElementById(id);
const screens = [...document.querySelectorAll(".screen")];

const STORAGE_KEY = "flashMentalYellow.v3";
const LEGACY_STORAGE_KEYS = [
  "flashMentalYellow.v2",
  "flashMentalYellow.v1"
];
const LOCAL_PLAYER_ID_KEY = "flashMentalYellow.localFallbackPlayerId.v1";
const EDITION = "yellow";
const CLIENT_VERSION = "web-v11.0";
const MAX_RANKING = 1000;
const LIMIT_TIME = 10.0;

const state = {
  nickname: "",
  authUserId: "",
  localPlayerId: "",
  authReady: false,
  authMode: "initializing",
  onlineVerified: false,
  onlineError: "",
  runId: "",
  runStartedAt: 0,
  questionsAnswered: 0,
  level: 1,
  playerHp: 100,
  playerMaxHp: 100,
  enemyHp: 100,
  enemyMaxHp: 100,
  bossHp: 600,
  bossMaxHp: 600,
  mode: "enemy",
  nums: [],
  answer: 0,
  answerText: "",
  answering: false,
  answerDeadline: 0,
  timerRAF: null,
  paused: false,
  pauseStartedAt: 0,
  pausedTotalMs: 0,
  answerPauseRemainingMs: 0,
  pausedMedia: [],
  readyAudio: null,
  readyAudioShouldResume: false,
  questionSerial: 0,
  voiceRecognition: null,
  voiceListening: false,
  voiceResultPending: false,
  runActive: false,
  eligibleForOnlineRanking: true,
  bestLevel: 0,
  history: [],
  settings: {
    fontSize: "normal",
    sfx: true,
    vibration: true
  }
};

let audioCtx = null;

const media = {
  ready: new Audio("./assets/ready_countdown.mp3"),
  go: new Audio("./assets/go.wav"),
  correct: new Audio("./assets/correct.mp3"),
  wrong: new Audio("./assets/wrong.mp3"),
  hit: new Audio("./assets/hit.mp3"),
  death: new Audio("./assets/enemy_death.mp3"),
  bossBgm: new Audio("./assets/boss_bgm.mp3")
};
media.ready.preload = "auto";
media.go.preload = "auto";
media.bossBgm.loop = true;
media.bossBgm.volume = 0.26;

function safePlay(audio, volume=null) {
  if (!state.settings.sfx && audio !== media.bossBgm) return;
  if (audio === media.bossBgm && !state.settings.sfx) return;
  try {
    if (volume !== null) audio.volume = volume;
    audio.currentTime = 0;
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch(()=>{});
  } catch (_) {}
}

function stopBossBgm() {
  try {
    media.bossBgm.pause();
    media.bossBgm.currentTime = 0;
  } catch (_) {}
}

function showScreen(name) {
  screens.forEach(s => s.classList.toggle("active", s.id === `screen-${name}`));
  document.body.classList.toggle("game-active", name === "game");
}

function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

function vibrate(pattern) {
  if (state.settings.vibration && navigator.vibrate) navigator.vibrate(pattern);
}

function beep(freq=440, dur=0.07, gain=0.035, type="sine") {
  if (!state.settings.sfx) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + dur);
  } catch (_) {}
}

function stopReadyAudio(reset=true) {
  const audio = state.readyAudio;

  if (audio) {
    try {
      audio.pause();

      if (reset) {
        audio.currentTime = 0;
      }

      audio.onended = null;
      audio.onerror = null;
    } catch (_) {}
  }

  state.readyAudio = null;
  state.readyAudioShouldResume = false;
}

async function waitUntilResumed() {
  while (state.runActive && state.paused) {
    await sleep(40);
  }

  return state.runActive;
}

async function getReadyAudioDuration(audio) {
  const existing = Number(audio.duration);

  if (Number.isFinite(existing) && existing > 0) {
    return existing;
  }

  await new Promise(resolve => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;

      audio.removeEventListener("loadedmetadata", finish);
      audio.removeEventListener("durationchange", finish);
      resolve();
    };

    audio.addEventListener("loadedmetadata", finish, {once:true});
    audio.addEventListener("durationchange", finish, {once:true});

    // Do not let metadata loading hold the game forever.
    setTimeout(finish, 800);
  });

  const duration = Number(audio.duration);

  return (
    Number.isFinite(duration) && duration > 0
      ? duration
      : 6.0
  );
}

async function readyCountdown(questionId) {
  /*
    Important pause rule:
    If the game is already paused when the next question reaches READY?,
    do NOT start the countdown sound in the background.
  */
  const canStart = await waitUntilResumed();

  if (
    !canStart ||
    !state.runActive ||
    questionId !== state.questionSerial
  ) {
    return false;
  }

  // Every question gets a completely fresh audio element.
  // No currentTime / ended / play-promise state is inherited
  // from a previous READY countdown.
  stopReadyAudio(true);

  const audio = new Audio("./assets/ready_countdown.mp3");
  audio.preload = "auto";
  audio.volume = .42;

  state.readyAudio = audio;
  state.readyAudioShouldResume = false;

  audio.onended = () => {
    if (state.readyAudio === audio) {
      state.readyAudio = null;
      state.readyAudioShouldResume = false;
    }
  };

  let duration = await getReadyAudioDuration(audio);

  // A pause can happen while metadata is loading.
  // If so, wait BEFORE starting playback.
  const stillCanStart = await waitUntilResumed();

  if (
    !stillCanStart ||
    !state.runActive ||
    questionId !== state.questionSerial ||
    state.readyAudio !== audio
  ) {
    if (state.readyAudio === audio) {
      stopReadyAudio(true);
    }
    return false;
  }

  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    console.warn("READY audio could not start:", error);
    // The visual countdown still proceeds even if browser audio fails.
  }

  /*
    Original pygame behavior:
      READY_DELAY = ready_se.get_length() - 1.8

    pausableSleep freezes this delay during pause.
    The sound itself is independently paused/resumed by pauseGame/resumeGame.
  */
  const readyDelaySec = Math.max(0, duration - 1.8);

  await pausableSleep(readyDelaySec * 1000);

  return (
    state.runActive &&
    questionId === state.questionSerial
  );
}

function hitSound() {
  safePlay(media.correct, .38);
  safePlay(media.hit, .24);
}
function missSound() {
  safePlay(media.wrong, .38);
  safePlay(media.miss, .20);
}
function levelSound() {
  beep(520,.06,.025);
  setTimeout(()=>beep(660,.07,.025),70);
  setTimeout(()=>beep(880,.12,.03),145);
}

function getDifficulty(lv) {
  const count = Math.min(3 + Math.floor((lv - 1) / 2), 25);
  const interval = Math.max(0.85 - ((lv - 1) * 0.015), 0.12);
  return { min:1, count, interval };
}

function randomInt(a,b) {
  return Math.floor(Math.random()*(b-a+1))+a;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pausableSleep(ms) {
  let remaining = Math.max(0, Number(ms) || 0);
  let last = performance.now();

  while (remaining > 0 && state.runActive) {
    await sleep(Math.min(remaining, 40));

    const now = performance.now();

    if (!state.paused) {
      remaining -= Math.max(0, now - last);
    }

    last = now;
  }
}

function makeUUID() {
  if (globalThis.crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random()*16|0;
    const v = c === "x" ? r : (r&0x3|0x8);
    return v.toString(16);
  });
}

function ensureLocalPlayerId() {
  let id = localStorage.getItem(LOCAL_PLAYER_ID_KEY);
  if (!id) {
    id = makeUUID();
    localStorage.setItem(LOCAL_PLAYER_ID_KEY, id);
  }
  state.localPlayerId = id;
  return id;
}


const PENDING_ONLINE_KEY = "flashMentalYellow.pendingOnlineScores.v1";

function loadPendingOnlineScores() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_ONLINE_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePendingOnlineScores(rows) {
  localStorage.setItem(
    PENDING_ONLINE_KEY,
    JSON.stringify((rows || []).slice(-200))
  );
  updatePendingScoreStatus();
}

function queuePendingOnlineScore(row) {
  const rows = loadPendingOnlineScores();

  if (!rows.some(r => r.run_id === row.run_id)) {
    rows.push(row);
  }

  savePendingOnlineScores(rows);
}

function updatePendingScoreStatus() {
  const el = $("pendingScoreStatus");
  if (!el) return;

  const n = loadPendingOnlineScores().length;
  el.textContent = n > 0 ? `未送信スコア ${n}件` : "";
}

let supabaseClient = null;

function onlineConfigured() {
  const c = window.APP_CONFIG || {};
  return !!(
    c.ONLINE_RANKING &&
    c.USE_ANONYMOUS_AUTH &&
    c.SUPABASE_URL &&
    c.SUPABASE_PUBLISHABLE_KEY
  );
}

function getRankingPlayerId() {
  return state.authUserId || state.localPlayerId || ensureLocalPlayerId();
}


async function verifyOnlineRankingConnection() {
  state.onlineVerified = false;
  state.onlineError = "";

  if (!onlineConfigured()) {
    state.onlineError = "config.js のオンライン設定が未完了です";
    return false;
  }

  if (!supabaseClient || !state.authUserId) {
    state.onlineError = "匿名認証が完了していません";
    return false;
  }

  try {
    const { error } = await supabaseClient.rpc(
      "get_flash_ranking",
      { p_limit: 1 }
    );

    if (error) throw error;

    state.onlineVerified = true;
    state.onlineError = "";
    return true;

  } catch (error) {
    console.error("Online ranking verification failed:", error);
    state.onlineVerified = false;
    state.onlineError =
      `${error.code || "ERROR"}: ${error.message || "ランキングDBへ接続できません"}`;
    return false;
  }
}

async function syncPendingOnlineScores() {
  if (
    !onlineConfigured() ||
    !state.onlineVerified ||
    !supabaseClient ||
    !state.authUserId
  ) {
    updatePendingScoreStatus();
    return;
  }

  const pending = loadPendingOnlineScores();
  if (!pending.length) {
    updatePendingScoreStatus();
    return;
  }

  const remaining = [];

  for (const row of pending) {
    try {
      const { error } = await supabaseClient.rpc(
        "submit_flash_score",
        {
          p_run_id: row.run_id,
          p_nickname: row.nickname,
          p_level: row.level,
          p_duration_ms: row.duration_ms,
          p_questions_answered: row.questions_answered,
          p_client_version: row.client_version || CLIENT_VERSION
        }
      );

      if (error) throw error;
    } catch (error) {
      console.error("Pending score sync failed:", error);
      remaining.push(row);
    }
  }

  savePendingOnlineScores(remaining);
}

async function runOnlineConnectionTest(showToast=true) {
  updateOnlineStatus("オンラインランキングへ接続テスト中…");

  const ok = await verifyOnlineRankingConnection();

  if (ok) {
    await syncPendingOnlineScores();
    updateOnlineStatus();

    if (showToast) {
      toast("オンラインランキング接続OK");
    }
  } else {
    updateOnlineStatus();

    if (showToast) {
      toast(`オンライン接続NG：${state.onlineError}`);
    }
  }

  return ok;
}

async function initAnonymousAuth() {
  ensureLocalPlayerId();

  state.onlineVerified = false;
  state.onlineError = "";

  if (!onlineConfigured()) {
    state.authReady = true;
    state.authMode = "local";
    state.onlineError = "ONLINE_RANKING / Project URL / Publishable key を確認してください";
    updateOnlineStatus();
    updateStartButton();
    updatePendingScoreStatus();
    return;
  }

  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    state.authReady = true;
    state.authMode = "online-error";
    state.onlineError = "Supabaseライブラリを読み込めませんでした";
    updateOnlineStatus();
    updateStartButton();
    updatePendingScoreStatus();
    return;
  }

  try {
    const c = window.APP_CONFIG;

    supabaseClient = window.supabase.createClient(
      c.SUPABASE_URL,
      c.SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      }
    );

    const {
      data: { session },
      error: sessionError
    } = await supabaseClient.auth.getSession();

    if (sessionError) throw sessionError;

    if (session?.user?.id) {
      state.authUserId = session.user.id;
    } else {
      const { data, error } = await supabaseClient.auth.signInAnonymously();

      if (error) throw error;
      if (!data?.user?.id) {
        throw new Error("匿名ユーザーIDを取得できませんでした");
      }

      state.authUserId = data.user.id;
    }

    state.authReady = true;
    state.authMode = "anonymous-auth";

    await verifyOnlineRankingConnection();

    if (state.onlineVerified) {
      await syncPendingOnlineScores();
    }

    updateOnlineStatus();
    updateStartButton();
    updatePendingScoreStatus();

  } catch (error) {
    console.error("Anonymous auth failed:", error);

    state.authUserId = "";
    state.authReady = true;
    state.authMode = "online-error";
    state.onlineVerified = false;
    state.onlineError =
      `${error.code || "AUTH"}: ${error.message || "匿名認証に失敗しました"}`;

    updateOnlineStatus();
    updateStartButton();
    updatePendingScoreStatus();
  }
}

function cleanNickname(value) {
  return Array.from(
    String(value || "")
      .normalize("NFKC")
      .replace(/[\\u0000-\\u001F\\u007F]/g, "")
      .replace(/\\s+/g, " ")
      .trim()
  ).slice(0, 12).join("");
}

function saveLocal() {
  const payload = {
    version:3,
    nickname:state.nickname,
    bestLevel:state.bestLevel,
    history:state.history.slice(0,100),
    settings:state.settings,
    resume: state.runActive ? {
      level:state.level,
      playerHp:state.playerHp,
      enemyHp:state.enemyHp,
      bossHp:state.bossHp,
      mode:state.mode,
      runId:state.runId,
      runStartedAt:state.runStartedAt,
      questionsAnswered:state.questionsAnswered
    } : null
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

function loadLocal() {
  ensureLocalPlayerId();

  try {
    let raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      for (const key of LEGACY_STORAGE_KEYS) {
        raw = localStorage.getItem(key);
        if (raw) break;
      }
    }

    if (raw) {
      const d = JSON.parse(raw);
      state.nickname = cleanNickname(d.nickname || "");
      state.bestLevel = Number(d.bestLevel || 0);
      state.history = Array.isArray(d.history) ? d.history.slice(0,100) : [];
      state.settings = {...state.settings, ...(d.settings || {})};
      $("nickname").value = state.nickname;
    }
  } catch (_) {}

  applySettings();
}


function applySettings() {
  const scales = {normal:"1", large:"1.18", xlarge:"1.36"};
  document.documentElement.style.setProperty("--font-scale", scales[state.settings.fontSize] || "1");
  $("sfxToggle").checked = !!state.settings.sfx;
  $("vibrationToggle").checked = !!state.settings.vibration;
  document.querySelectorAll("[data-font-size]").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.fontSize === state.settings.fontSize);
  });
}

function updateStartButton() {
  const nicknameOk = cleanNickname($("nickname").value).length > 0;
  const privacyOk = $("privacyCheck").checked;
  const authAttemptComplete = state.authReady;

  $("startBtn").disabled = !(
    nicknameOk &&
    privacyOk &&
    authAttemptComplete
  );
}

function renderAnswer() {
  $("answerDigits").textContent = state.answerText;
}

function clearAnswer() {
  state.answerText = "";
  renderAnswer();
}

function appendAnswerDigit(digit) {
  if (!state.answering || state.paused) return;
  if (!/^\d$/.test(String(digit))) return;
  if (state.answerText.length >= 6) return;

  state.answerText += String(digit);
  renderAnswer();
  beep(430 + Number(digit)*14, .025, .012, "square");
}

function backspaceAnswer() {
  if (!state.answering || state.paused) return;
  state.answerText = state.answerText.slice(0,-1);
  renderAnswer();
}


const SpeechRecognitionCtor =
  window.SpeechRecognition ||
  window.webkitSpeechRecognition ||
  null;

function setVoiceStatus(message="") {
  const el = $("voiceStatus");
  if (el) el.textContent = message;
}

function setVoiceButtonState() {
  const btn = $("voiceAnswerBtn");
  if (!btn) return;

  const supported = !!SpeechRecognitionCtor;

  btn.disabled =
    !supported ||
    !state.answering ||
    state.paused;

  btn.classList.toggle("unsupported", !supported);
  btn.classList.toggle("listening", !!state.voiceListening);

  if (!supported) {
    btn.textContent = "🎤";
    btn.title = "このブラウザでは音声入力を利用できません";
  } else if (state.voiceListening) {
    btn.textContent = "🎙️";
    btn.title = "聞き取り中。タップで中止";
  } else {
    btn.textContent = "🎤";
    btn.title = "マイクで答えを入力";
  }
}

function stopVoiceRecognition({clearStatus=false}={}) {
  const rec = state.voiceRecognition;

  state.voiceResultPending = false;

  if (rec) {
    try {
      rec.onresult = null;
      rec.onerror = null;
      rec.onnomatch = null;
      rec.onstart = null;
      rec.onend = null;
      rec.abort();
    } catch (_) {}
  }

  state.voiceRecognition = null;
  state.voiceListening = false;

  if (clearStatus) {
    setVoiceStatus("");
  }

  setVoiceButtonState();
}

function normalizeJapaneseSpeechText(text) {
  return String(text || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[，、。．,.!！?？]/g, "")
    .replace(/\s+/g, "")
    .replace(/答えは?|こたえは?/g, "")
    .replace(/です$/g, "");
}

function parseJapaneseKanjiNumber(text) {
  const s = text
    .replace(/[〇零]/g, "0")
    .replace(/一/g, "1")
    .replace(/二/g, "2")
    .replace(/三/g, "3")
    .replace(/四/g, "4")
    .replace(/五/g, "5")
    .replace(/六/g, "6")
    .replace(/七/g, "7")
    .replace(/八/g, "8")
    .replace(/九/g, "9");

  // Pure converted digits such as "一二三" -> 123.
  if (/^\d+$/.test(s)) {
    return Number(s);
  }

  // Japanese integer grammar sufficient for this game's answer range.
  // Supports values through 999.
  let rest = s;
  let total = 0;

  const hundred = rest.match(/^(\d)?百/);
  if (hundred) {
    total += Number(hundred[1] || 1) * 100;
    rest = rest.slice(hundred[0].length);
  }

  const ten = rest.match(/^(\d)?十/);
  if (ten) {
    total += Number(ten[1] || 1) * 10;
    rest = rest.slice(ten[0].length);
  }

  if (/^\d$/.test(rest)) {
    total += Number(rest);
    rest = "";
  }

  return rest === "" ? total : null;
}

function kanaNumberToKanji(text) {
  let s = text;

  const replacements = [
    ["にひゃく","二百"],
    ["ひゃく","百"],
    ["にじゅう","二十"],
    ["さんじゅう","三十"],
    ["よんじゅう","四十"],
    ["しじゅう","四十"],
    ["ごじゅう","五十"],
    ["ろくじゅう","六十"],
    ["ななじゅう","七十"],
    ["しちじゅう","七十"],
    ["はちじゅう","八十"],
    ["きゅうじゅう","九十"],
    ["くじゅう","九十"],
    ["じゅう","十"],
    ["ぜろ","零"],
    ["れい","零"],
    ["いち","一"],
    ["に","二"],
    ["さん","三"],
    ["よん","四"],
    ["し","四"],
    ["ご","五"],
    ["ろく","六"],
    ["なな","七"],
    ["しち","七"],
    ["はち","八"],
    ["きゅう","九"],
    ["く","九"]
  ];

  for (const [from,to] of replacements) {
    s = s.split(from).join(to);
  }

  return s;
}

function parseSpokenAnswer(transcript) {
  let s = normalizeJapaneseSpeechText(transcript);

  // Most recognition engines return Arabic digits for spoken numbers.
  const digitMatch = s.match(/\d{1,3}/);
  if (digitMatch) {
    const value = Number(digitMatch[0]);
    return Number.isInteger(value) && value >= 0 && value <= 999
      ? value
      : null;
  }

  // Convert common kana readings first.
  s = kanaNumberToKanji(s);

  if (!/^[〇零一二三四五六七八九十百0-9]+$/.test(s)) {
    return null;
  }

  const value = parseJapaneseKanjiNumber(s);

  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 999
      ? value
      : null
  );
}

function startVoiceInput() {
  if (
    !SpeechRecognitionCtor ||
    !state.runActive ||
    !state.answering ||
    state.paused
  ) {
    return;
  }

  if (state.voiceListening) {
    stopVoiceRecognition({clearStatus:true});
    return;
  }

  stopVoiceRecognition({clearStatus:false});

  const recognition = new SpeechRecognitionCtor();

  recognition.lang = "ja-JP";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 3;

  const questionId = state.questionSerial;

  state.voiceRecognition = recognition;
  state.voiceResultPending = false;

  recognition.onstart = () => {
    if (state.voiceRecognition !== recognition) return;

    state.voiceListening = true;
    state.voiceResultPending = false;
    setVoiceStatus("🎙️ 聞いています… 答えを言ってください");
    setVoiceButtonState();
  };

  recognition.onresult = (event) => {
    if (
      state.voiceRecognition !== recognition ||
      !state.answering ||
      state.paused ||
      questionId !== state.questionSerial
    ) {
      return;
    }

    const alternatives = [];

    for (let r = 0; r < event.results.length; r++) {
      const result = event.results[r];

      for (let a = 0; a < result.length; a++) {
        alternatives.push(result[a].transcript);
      }
    }

    let parsed = null;
    let usedTranscript = "";

    for (const transcript of alternatives) {
      const value = parseSpokenAnswer(transcript);

      if (value !== null) {
        parsed = value;
        usedTranscript = transcript;
        break;
      }
    }

    if (parsed === null) {
      setVoiceStatus("数字を聞き取れませんでした。もう一度🎤を押してください");
      toast("数字を聞き取れませんでした");
      return;
    }

    state.voiceResultPending = true;
    state.answerText = String(parsed);
    renderAnswer();

    setVoiceStatus(
      `「${usedTranscript.trim()}」→ ${parsed}`
    );

    // Stop listening immediately after a usable answer.
    try {
      recognition.stop();
    } catch (_) {}

    // One-tap voice answer: show what was recognized very briefly,
    // then submit automatically.
    setTimeout(() => {
      if (
        state.runActive &&
        state.answering &&
        !state.paused &&
        questionId === state.questionSerial &&
        state.answerText === String(parsed)
      ) {
        submitAnswer(false);
      }
    }, 420);
  };

  recognition.onnomatch = () => {
    if (state.voiceRecognition !== recognition) return;

    state.voiceResultPending = false;
    setVoiceStatus("聞き取れませんでした。もう一度どうぞ");
    toast("聞き取れませんでした");
  };

  recognition.onerror = (event) => {
    if (state.voiceRecognition !== recognition) return;

    state.voiceResultPending = false;

    let message = "音声入力を開始できませんでした";

    if (event.error === "not-allowed" || event.error === "service-not-allowed") {
      message = "マイクの使用を許可してください";
    } else if (event.error === "no-speech") {
      message = "声が聞き取れませんでした";
    } else if (event.error === "audio-capture") {
      message = "マイクを使用できません";
    } else if (event.error === "network") {
      message = "音声認識の通信に失敗しました";
    } else if (event.error === "aborted") {
      // User/pause/new question cancellation: no warning needed.
      message = "";
    }

    if (message) {
      setVoiceStatus(message);
      toast(message);
    }
  };

  recognition.onend = () => {
    if (state.voiceRecognition !== recognition) return;

    state.voiceRecognition = null;
    state.voiceListening = false;
    setVoiceButtonState();

    if (
      !state.voiceResultPending &&
      state.answering &&
      !state.paused &&
      !$("voiceStatus").textContent
    ) {
      setVoiceStatus("🎤を押して答えを言えます");
    }
  };

  try {
    setVoiceStatus("マイクを準備しています…");
    recognition.start();
  } catch (error) {
    console.warn("SpeechRecognition start failed:", error);
    state.voiceRecognition = null;
    state.voiceListening = false;
    setVoiceStatus("音声入力を開始できませんでした");
    setVoiceButtonState();
  }
}

function initializeVoiceInputUI() {
  const btn = $("voiceAnswerBtn");

  if (!btn) return;

  if (!SpeechRecognitionCtor) {
    btn.disabled = true;
    btn.classList.add("unsupported");
    setVoiceStatus("このブラウザでは音声入力を利用できません");
  } else {
    btn.disabled = true;
    setVoiceStatus("🎤を押して答えを言えます");
  }

  setVoiceButtonState();
}

function enemyProfileForLevel(level) {
  // Keep the enemy progression monotonic.
  // HP changes never swap a strong enemy back to a weaker character.
  if (level >= 50) {
    return {
      title: "FINAL BOSS",
      image: "./assets/boss.png",
      tier: "boss"
    };
  }

  if (level >= 35) {
    return {
      title: "狂戦士ゴブリン",
      image: "./assets/goblin_angry.png",
      tier: "berserker"
    };
  }

  if (level >= 20) {
    return {
      title: "武装ゴブリン",
      image: "./assets/goblin4.png",
      tier: "armored"
    };
  }

  return {
    title: "ゴブリン",
    image: "./assets/goblin.png",
    tier: "normal"
  };
}

function showDamagePop(id, text) {
  const el = $(id);
  if (!el) return;

  el.textContent = text;
  el.classList.remove("pop");

  // Restart CSS animation reliably.
  void el.offsetWidth;
  el.classList.add("pop");
}

function pauseGame() {
  if (!state.runActive || state.paused) return;

  // Never leave the microphone listening behind the pause overlay.
  stopVoiceRecognition({clearStatus:false});

  state.paused = true;
  state.pauseStartedAt = Date.now();

  // Freeze the answer timer exactly where it is.
  if (state.answering) {
    state.answerPauseRemainingMs = Math.max(
      0,
      state.answerDeadline - performance.now()
    );
    cancelAnimationFrame(state.timerRAF);
  }

  /*
    READY audio:
    Pause only the CURRENT question's countdown sound.
    If the next READY has not started yet, there is nothing to play/pause,
    and readyCountdown() will wait until resume.
  */
  state.readyAudioShouldResume = false;

  const readyAudio = state.readyAudio;

  if (readyAudio) {
    try {
      if (!readyAudio.paused && !readyAudio.ended) {
        state.readyAudioShouldResume = true;
        readyAudio.pause();
      }
    } catch (_) {}
  }

  // Other long-running audio.
  state.pausedMedia = [];

  for (const audio of [media.bossBgm]) {
    try {
      if (!audio.paused && !audio.ended) {
        state.pausedMedia.push(audio);
        audio.pause();
      }
    } catch (_) {}
  }

  $("pauseOverlay").classList.remove("hidden");
}

function resumeGame() {
  if (!state.runActive || !state.paused) return;

  const pausedFor = Math.max(
    0,
    Date.now() - state.pauseStartedAt
  );

  state.pausedTotalMs += pausedFor;
  state.pauseStartedAt = 0;
  state.paused = false;

  $("pauseOverlay").classList.add("hidden");

  // Continue answer countdown from the same remaining time.
  if (state.answering) {
    state.answerDeadline =
      performance.now() + state.answerPauseRemainingMs;

    state.answerPauseRemainingMs = 0;
    tickAnswerTimer();
  }

  /*
    Resume the same READY audio only when:
    - it existed when pause was pressed
    - it is still the current READY audio
    - it has not already ended
  */
  const readyAudio = state.readyAudio;

  if (
    state.readyAudioShouldResume &&
    readyAudio &&
    !readyAudio.ended
  ) {
    try {
      const p = readyAudio.play();

      if (p && typeof p.catch === "function") {
        p.catch(error => {
          console.warn("READY audio resume failed:", error);
        });
      }
    } catch (_) {}
  }

  state.readyAudioShouldResume = false;

  // Continue other paused audio.
  for (const audio of state.pausedMedia) {
    try {
      const p = audio.play();

      if (p && typeof p.catch === "function") {
        p.catch(()=>{});
      }
    } catch (_) {}
  }

  state.pausedMedia = [];
  setVoiceButtonState();

  if (state.answering && SpeechRecognitionCtor) {
    setVoiceStatus("🎤を押して答えを言えます");
  }
}

function togglePause() {
  if (state.paused) {
    resumeGame();
  } else {
    pauseGame();
  }
}

function startRun() {
  const nickname = cleanNickname($("nickname").value);
  if (!nickname || !$("privacyCheck").checked) return;

  state.nickname = nickname;
  $("nickname").value = nickname;
  state.runId = makeUUID();
  state.runStartedAt = Date.now();
  state.questionsAnswered = 0;
  state.paused = false;
  state.pauseStartedAt = 0;
  state.pausedTotalMs = 0;
  state.answerPauseRemainingMs = 0;
  state.pausedMedia = [];
  stopReadyAudio(true);
  state.readyAudioShouldResume = false;
  state.questionSerial = 0;
  stopVoiceRecognition({clearStatus:true});
  $("pauseOverlay").classList.add("hidden");
  state.level = 1;
  state.playerHp = 100;
  state.enemyHp = 100;
  state.bossHp = 600;
  state.mode = "enemy";
  state.runActive = true;
  state.eligibleForOnlineRanking = true;
  saveLocal();

  showScreen("game");
  updateBattleUI();
  newQuestion();
}

function updateBattleUI() {
  $("playerLabel").textContent = `Lv.${state.level} ${state.nickname}`;
  $("levelChip").textContent = `Lv.${state.level}`;
  $("playerHpFill").style.width =
    `${Math.max(0,state.playerHp/state.playerMaxHp*100)}%`;

  const boss = state.mode === "boss" || state.level >= 50;
  const hp = boss ? state.bossHp : state.enemyHp;
  const max = boss ? state.bossMaxHp : state.enemyMaxHp;

  $("enemyHpFill").style.width =
    `${Math.max(0,hp/max*100)}%`;

  const img = $("enemyImage");
  const profile = enemyProfileForLevel(state.level);

  img.classList.remove("angry","dying","enraged");

  if (hp <= 0 && !boss) {
    // Only the defeated state changes to the dying illustration.
    img.src = "./assets/goblin_dying.png";
    img.classList.add("dying");
    $("enemyTitle").textContent = `${profile.title}　撃破！`;
  } else {
    // During a fight, keep the SAME enemy image from start to finish.
    img.src = profile.image;
    $("enemyTitle").textContent = profile.title;

    // Low HP can add a glow, but never swaps to a different enemy.
    if (!boss && hp <= max*.5) {
      img.classList.add("enraged");
    }
  }

  if (boss) {
    if (state.settings.sfx && media.bossBgm.paused) {
      try {
        media.bossBgm.currentTime = 0;
        media.bossBgm.play().catch(()=>{});
      } catch (_) {}
    }
  } else {
    stopBossBgm();
  }
}

async function newQuestion() {
  if (!state.runActive) return;

  stopVoiceRecognition({clearStatus:true});

  const questionId = ++state.questionSerial;

  state.answering = false;
  clearAnswer();

  /*
    Clean up any READY sound left from the previous question.
    The next sound will always start from 0 with a fresh Audio object.
  */
  stopReadyAudio(true);

  $("answerPanel").classList.add("hidden");
  $("flashNumber").textContent = "";
  $("readyText").classList.remove("hidden");
  $("readyText").textContent = "READY?";

  const {count, interval} = getDifficulty(state.level);

  state.nums = Array.from(
    {length:count},
    () => randomInt(1,9)
  );

  state.answer = state.nums.reduce((a,b)=>a+b,0);

  /*
    If pause is already open here, readyCountdown waits silently.
    No READY sound can begin behind the pause overlay.
  */
  const readyCompleted = await readyCountdown(questionId);

  if (
    !readyCompleted ||
    !state.runActive ||
    questionId !== state.questionSerial
  ) {
    return;
  }

  $("readyText").classList.add("hidden");

  for (const n of state.nums) {
    if (
      !state.runActive ||
      questionId !== state.questionSerial
    ) {
      return;
    }

    $("flashNumber").textContent = n;
    await pausableSleep(interval * 850);

    if (
      !state.runActive ||
      questionId !== state.questionSerial
    ) {
      return;
    }

    $("flashNumber").textContent = "";
    await pausableSleep(interval * 150);
  }

  await pausableSleep(800);

  if (
    !state.runActive ||
    questionId !== state.questionSerial
  ) {
    return;
  }

  beginAnswer();
}

function beginAnswer() {
  state.answering = true;
  clearAnswer();

  $("flashNumber").textContent = "";
  $("answerPanel").classList.remove("hidden");

  if (SpeechRecognitionCtor) {
    setVoiceStatus("🎤を押して答えを言えます");
  } else {
    setVoiceStatus("音声入力非対応：数字パッドで回答してください");
  }
  setVoiceButtonState();

  state.answerDeadline =
    performance.now() + LIMIT_TIME*1000;

  // No text-box tap is necessary:
  // mobile users immediately get the on-screen number pad;
  // PC users can type digits globally.
  tickAnswerTimer();
}


function tickAnswerTimer() {
  cancelAnimationFrame(state.timerRAF);
  const tick = () => {
    if (!state.answering) return;

    if (state.paused) {
      return;
    }

    const remaining = Math.max(0, (state.answerDeadline - performance.now()) / 1000);
    $("timeText").textContent = `残り ${remaining.toFixed(1)}秒`;
    $("timeFill").style.width = `${remaining/LIMIT_TIME*100}%`;
    $("timeFill").style.background = remaining > 3 ? "#0096ff" : "#dc3c3c";
    if (remaining <= 0) {
      submitAnswer(true);
      return;
    }
    state.timerRAF = requestAnimationFrame(tick);
  };
  tick();
}

function submitAnswer(timedOut=false) {
  if (!state.answering || state.paused) return;

  stopVoiceRecognition({clearStatus:true});

  const value = state.answerText.trim();

  if (!timedOut && value === "") return;

  state.answering = false;
  cancelAnimationFrame(state.timerRAF);
  state.questionsAnswered += 1;

  const correct =
    !timedOut &&
    Number(value) === state.answer;

  let damage = 0;

  if (correct) {
    // Same formula as the original Python code.
    damage = randomInt(35,50) + state.level;

    if (state.mode === "enemy") {
      state.enemyHp -= damage;
    } else {
      state.bossHp -= damage;
    }

    hitSound();
    vibrate(35);

    showDamagePop(
      "enemyDamagePop",
      `-${damage} DAMAGE!`
    );

  } else {
    // Same fixed player damage as the original Python code.
    damage = 15;
    state.playerHp -= damage;

    missSound();
    vibrate([65,45,65]);

    showDamagePop(
      "playerDamagePop",
      `-${damage} DAMAGE`
    );
  }

  updateBattleUI();
  showJudge(correct, damage, timedOut);
}

async function showJudge(correct, damage, timedOut=false) {
  $("judgeMark").textContent =
    correct ? "○" : "×";

  $("judgeMark").className =
    `judge-mark ${correct ? "correct" : "wrong"}`;

  if (correct) {
    $("judgeMessage").textContent =
      `正解！ 敵に ${damage} ダメージ`;
    $("correctAnswer").textContent =
      `答え：${state.answer}`;
  } else {
    $("judgeMessage").textContent =
      timedOut
        ? `時間切れ！ 自分に ${damage} ダメージ`
        : `不正解… 自分に ${damage} ダメージ`;

    $("correctAnswer").textContent =
      `正解：${state.answer}`;
  }

  $("judgeOverlay").classList.remove("hidden");

  // Keep it short enough that HP/damage remain easy to follow.
  await sleep(950);

  $("judgeOverlay").classList.add("hidden");

  const enemyDead =
    state.mode === "enemy"
      ? state.enemyHp <= 0
      : state.bossHp <= 0;

  if (enemyDead) {
    updateBattleUI();
    safePlay(media.death, .34);

    // Let the dying illustration / "撃破!" be seen.
    await sleep(650);
    await handleVictory();

  } else if (state.playerHp > 0) {
    saveLocal();
    newQuestion();

  } else {
    await finishRun(false);
  }
}


async function handleVictory() {
  showScreen("levelup");
  $("clearImage").classList.add("hidden");

  if (state.level >= 50 && state.mode === "boss") {
    stopBossBgm();
    $("clearImage").classList.remove("hidden");
    $("levelupText").textContent = "WORLD PEACE!!";
    $("levelupSub").textContent = "ルミネ姫を救出した！";
    levelSound();
    await sleep(1500);
    await finishRun(true);
    return;
  }

  $("levelupText").textContent = `LEVEL UP! → ${state.level + 1}`;
  $("levelupSub").textContent = "HPが少し回復した！";
  levelSound();
  await sleep(1500);

  state.level += 1;
  state.playerHp = Math.min(state.playerMaxHp, state.playerHp + 20);

  if (state.level === 50) {
    state.mode = "boss";
    state.bossHp = state.bossMaxHp;
  } else {
    state.mode = "enemy";
    state.enemyHp = state.enemyMaxHp;
  }

  saveLocal();
  showScreen("game");
  updateBattleUI();
  newQuestion();
}

async function finishRun(worldPeace=false) {
  stopVoiceRecognition({clearStatus:true});
  state.runActive = false;
  state.questionSerial += 1;
  stopReadyAudio(true);
  state.paused = false;
  state.pauseStartedAt = 0;
  $("pauseOverlay").classList.add("hidden");
  const achieved = Math.max(1, Math.min(50, state.level));
  state.bestLevel = Math.max(state.bestLevel, achieved);
  const currentPauseMs = (
    state.paused && state.pauseStartedAt
      ? Math.max(0, Date.now() - state.pauseStartedAt)
      : 0
  );

  const durationMs = Math.max(
    0,
    Date.now()
      - (state.runStartedAt || Date.now())
      - state.pausedTotalMs
      - currentPauseMs
  );
  state.history.unshift({
    level:achieved,
    at:new Date().toISOString(),
    worldPeace:!!worldPeace,
    runId:state.runId,
    durationMs,
    questionsAnswered:state.questionsAnswered
  });
  state.history = state.history.slice(0,100);
  saveLocal();

  let onlineText = "";
  if (state.eligibleForOnlineRanking) {
    const result = await submitOnlineScore(
      state.nickname,
      achieved,
      state.runId,
      durationMs,
      state.questionsAnswered
    );
    onlineText = result.ok ? "オンラインランキングに送信しました。" : result.message;
  } else {
    onlineText = "バックアップ復元後の途中プレイのため、オンラインランキングには送信していません。";
  }

  toast(`Lv.${achieved}で終了。${onlineText}`);
  await loadRanking();
  showScreen("ranking");
}

function quitRun() {
  stopVoiceRecognition({clearStatus:true});
  state.questionSerial += 1;
  stopReadyAudio(true);
  if (!state.runActive) {
    showScreen("home");
    return;
  }
  if (confirm("このプレイを終了しますか？")) finishRun(false);
}

// ----------------------------
// Ranking
// ----------------------------
function localRankKey(){ return "flashMentalYellow.localRanking.v3"; }

function loadLocalRankingRuns(){
  try {
    return JSON.parse(localStorage.getItem(localRankKey()) || "[]");
  } catch {
    return [];
  }
}

function bestRowsPerPlayer(rows){
  const best = new Map();

  for(const row of rows){
    const pid = row.player_id || row.playerId || "legacy-"+(row.nickname||"");
    const old = best.get(pid);

    if(
      !old ||
      Number(row.level) > Number(old.level) ||
      (
        Number(row.level) === Number(old.level) &&
        String(row.created_at||"") < String(old.created_at||"")
      )
    ){
      best.set(pid,row);
    }
  }

  return [...best.values()]
    .sort((a,b)=>
      Number(b.level)-Number(a.level) ||
      String(a.created_at||"").localeCompare(String(b.created_at||""))
    )
    .slice(0,MAX_RANKING);
}

function loadLocalRanking(){
  return bestRowsPerPlayer(loadLocalRankingRuns());
}

function saveLocalRanking(nickname,level,runId,durationMs,questionsAnswered){
  const rows=loadLocalRankingRuns();

  if(rows.some(r => r.run_id === runId)) return;

  rows.push({
    player_id:getRankingPlayerId(),
    run_id:runId,
    nickname,
    level:Number(level),
    duration_ms:Number(durationMs||0),
    questions_answered:Number(questionsAnswered||0),
    created_at:new Date().toISOString()
  });

  rows.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
  localStorage.setItem(localRankKey(),JSON.stringify(rows.slice(0,3000)));
}

async function submitOnlineScore(
  nickname,
  level,
  runId,
  durationMs,
  questionsAnswered
) {
  const payload = {
    run_id: runId,
    nickname: cleanNickname(nickname),
    level: Math.max(1,Math.min(50,Number(level))),
    duration_ms: Math.max(0,Math.round(Number(durationMs||0))),
    questions_answered: Math.max(0,Math.round(Number(questionsAnswered||0))),
    client_version: CLIENT_VERSION,
    created_at: new Date().toISOString()
  };

  /*
    Important v11 behavior:
    If ONLINE_RANKING=true, never pretend a local ranking is the online one.
    Failed submissions are queued for later sync instead.
  */
  if (!onlineConfigured()) {
    saveLocalRanking(
      payload.nickname,
      payload.level,
      payload.run_id,
      payload.duration_ms,
      payload.questions_answered
    );
    return {
      ok:false,
      localOnly:true,
      message:"オンラインランキングが未設定なので、この端末だけに保存しました。"
    };
  }

  if (
    state.authMode !== "anonymous-auth" ||
    !supabaseClient ||
    !state.authUserId ||
    !state.onlineVerified
  ) {
    queuePendingOnlineScore(payload);
    return {
      ok:false,
      queued:true,
      message:`オンライン接続できないため送信待ちに保存しました。${state.onlineError || ""}`
    };
  }

  try {
    const { error } = await supabaseClient.rpc(
      "submit_flash_score",
      {
        p_run_id: payload.run_id,
        p_nickname: payload.nickname,
        p_level: payload.level,
        p_duration_ms: payload.duration_ms,
        p_questions_answered: payload.questions_answered,
        p_client_version: payload.client_version
      }
    );

    if (error) throw error;

    return {ok:true};

  } catch (error) {
    console.error("Online score submit failed:", error);

    state.onlineError =
      `${error.code || "ERROR"}: ${error.message || "スコア送信に失敗しました"}`;

    queuePendingOnlineScore(payload);
    updateOnlineStatus();

    return {
      ok:false,
      queued:true,
      message:`オンライン送信に失敗したため送信待ちに保存しました。${state.onlineError}`
    };
  }
}

async function fetchOnlineRanking(){
  if (!onlineConfigured()) {
    return {
      source:"local",
      rows:loadLocalRanking()
    };
  }

  if (
    state.authMode !== "anonymous-auth" ||
    !supabaseClient ||
    !state.authUserId
  ) {
    throw new Error(
      state.onlineError ||
      "匿名認証が完了していません"
    );
  }

  if (!state.onlineVerified) {
    const ok = await verifyOnlineRankingConnection();

    if (!ok) {
      throw new Error(state.onlineError || "オンラインランキングへ接続できません");
    }
  }

  const { data, error } = await supabaseClient.rpc(
    "get_flash_ranking",
    { p_limit: MAX_RANKING }
  );

  if (error) throw error;

  return {
    source:"online",
    rows:data || []
  };
}

async function loadRanking(){
  const list=$("rankingList");
  const source=$("rankingSource");

  list.innerHTML=`<div class="rank-row"><span>…</span><span>読み込み中</span><span></span></div>`;
  source.textContent="接続先を確認中…";
  source.className="ranking-source";

  try{
    const result=await fetchOnlineRanking();
    const rows=result.rows || [];

    if(result.source==="online"){
      source.textContent="🌐 オンライン共通ランキング";
      source.className="ranking-source online";
    }else{
      source.textContent="📱 この端末だけのランキング（オンライン未設定）";
      source.className="ranking-source local";
    }

    list.innerHTML="";

    if(!rows.length){
      list.innerHTML=`<div class="rank-row"><span>-</span><span>まだ記録がありません</span><span>-</span></div>`;
      return;
    }

    rows.slice(0,MAX_RANKING).forEach((r,i)=>{
      const row=document.createElement("div");
      row.className=`rank-row ${i<3?"top3":""}`;

      const rank=document.createElement("span");
      const name=document.createElement("span");
      const lv=document.createElement("span");

      rank.textContent=`${i+1}位`;
      name.textContent=String(r.nickname||"名無し");
      name.className="rank-name";
      lv.textContent=`Lv.${r.level}`;

      row.append(rank,name,lv);
      list.append(row);
    });

  }catch(error){
    console.error("Ranking fetch failed:",error);

    const message =
      error?.message ||
      state.onlineError ||
      "オンラインランキングを取得できませんでした";

    source.textContent="🔴 オンラインランキング接続エラー";
    source.className="ranking-source error";

    list.innerHTML="";
    const row=document.createElement("div");
    row.className="rank-row";

    const mark=document.createElement("span");
    const text=document.createElement("span");
    const blank=document.createElement("span");

    mark.textContent="!";
    text.textContent=message;

    row.append(mark,text,blank);
    list.append(row);
  }
}

function updateOnlineStatus(customMessage=""){
  const el=$("onlineStatus");

  if(customMessage){
    el.textContent="⏳ "+customMessage;
    el.style.background="#eef1ff";
    return;
  }

  if(!onlineConfigured()){
    el.textContent="📱 オンラインランキング未設定：現在はこの端末だけ";
    el.style.background="#fff0bf";
    return;
  }

  if(!state.authReady){
    el.textContent="🔐 Supabase匿名認証中…";
    el.style.background="#eef1ff";
    return;
  }

  if(
    state.authMode==="anonymous-auth" &&
    state.onlineVerified
  ){
    el.textContent="🟢 オンライン共通ランキング接続済み";
    el.style.background="#dff6df";
    return;
  }

  el.textContent=
    `🔴 オンライン接続エラー：${state.onlineError || "接続を確認してください"}`;
  el.style.background="#ffe0e0";
}

// ----------------------------
// Backup
// ----------------------------
function exportBackup(){
  saveLocal();
  const payload={
    app:"flash-mental-yellow",
    exportedAt:new Date().toISOString(),
    data:JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}"),
    localRankingRuns:loadLocalRankingRuns()
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download=`flash-mental-backup-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  toast("バックアップを書き出しました");
}
async function importBackup(file){
  const text=await file.text();
  const payload=JSON.parse(text);
  if(payload.app!=="flash-mental-yellow" || !payload.data) throw new Error("形式が違います");

  localStorage.setItem(STORAGE_KEY,JSON.stringify(payload.data));

  if(Array.isArray(payload.localRankingRuns)){
    localStorage.setItem(localRankKey(),JSON.stringify(payload.localRankingRuns.slice(0,3000)));
  } else if(Array.isArray(payload.localRanking)){
    // v1 backup migration.
    const migrated = payload.localRanking.map((r,i)=>({
      player_id:ensureLocalPlayerId(),
      run_id:`legacy-${Date.now()}-${i}`,
      nickname:cleanNickname(r.nickname||r.name||"名無し"),
      level:Number(r.level||1),
      created_at:r.created_at||new Date().toISOString(),
      duration_ms:0,
      questions_answered:0
    }));
    localStorage.setItem(localRankKey(),JSON.stringify(migrated));
  }

  loadLocal();
  const resume=payload.data.resume;
  if(resume){
    state.level=Math.max(1,Math.min(50,Number(resume.level||1)));
    state.playerHp=Math.max(1,Math.min(100,Number(resume.playerHp||100)));
    state.enemyHp=Math.max(0,Math.min(100,Number(resume.enemyHp||100)));
    state.bossHp=Math.max(0,Math.min(600,Number(resume.bossHp||600)));
    state.mode=resume.mode==="boss"?"boss":"enemy";
    state.runId=resume.runId || makeUUID();
    state.runStartedAt=Number(resume.runStartedAt||Date.now());
    state.questionsAnswered=Number(resume.questionsAnswered||0);
    state.eligibleForOnlineRanking=false;
  }
  $("backupMessage").textContent="バックアップを復元しました。復元した途中プレイはオンラインランキング送信対象外です。";
  $("backupMessage").classList.remove("hidden");
  toast("バックアップを復元しました");
}

// ----------------------------
// Event wiring
// ----------------------------
$("nickname").addEventListener("input",updateStartButton);
$("privacyCheck").addEventListener("change",updateStartButton);
$("startBtn").addEventListener("click",startRun);

$("pauseBtn").addEventListener("click",pauseGame);
$("resumeBtn").addEventListener("click",resumeGame);

$("pauseQuitBtn").addEventListener("click",()=>{
  resumeGame();
  quitRun();
});

$("answerBtn").addEventListener(
  "click",
  ()=>submitAnswer(false)
);

$("answerBackspaceBtn").addEventListener(
  "click",
  backspaceAnswer
);

$("voiceAnswerBtn").addEventListener(
  "click",
  startVoiceInput
);

document.querySelectorAll("[data-digit]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    appendAnswerDigit(btn.dataset.digit);
  });
});

// PC: no input field needs focus. Just type.
document.addEventListener("keydown",(e)=>{
  if (!state.runActive) return;

  if (e.key === "p" || e.key === "P" || e.key === "Escape") {
    e.preventDefault();
    togglePause();
    return;
  }

  if (!state.answering || state.paused) return;

  if (/^\d$/.test(e.key)) {
    e.preventDefault();
    appendAnswerDigit(e.key);
    return;
  }

  if (e.key === "Backspace") {
    e.preventDefault();
    backspaceAnswer();
    return;
  }

  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    submitAnswer(false);
  }
});
$("testOnlineBtn").addEventListener("click",()=>runOnlineConnectionTest(true));
$("rankingBtn").addEventListener("click",async()=>{await loadRanking();showScreen("ranking")});
$("refreshRankingBtn").addEventListener("click",loadRanking);
$("backupBtn").addEventListener("click",()=>showScreen("backup"));
$("settingsBtn").addEventListener("click",()=>showScreen("settings"));
$("quitRunBtn").addEventListener("click",quitRun);
document.querySelectorAll("[data-back-home]").forEach(b=>b.addEventListener("click",()=>showScreen("home")));
$("exportBackupBtn").addEventListener("click",exportBackup);
$("importBackupInput").addEventListener("change",async(e)=>{
  const f=e.target.files?.[0];
  if(!f)return;
  try{await importBackup(f)}catch(err){
    $("backupMessage").textContent=`読み込みに失敗しました：${err.message}`;
    $("backupMessage").classList.remove("hidden");
  }
  e.target.value="";
});
document.querySelectorAll("[data-font-size]").forEach(btn=>{
  btn.addEventListener("click",()=>{
    state.settings.fontSize=btn.dataset.fontSize;
    applySettings();saveLocal();
  });
});
$("sfxToggle").addEventListener("change",()=>{state.settings.sfx=$("sfxToggle").checked;saveLocal();beep(620,.05,.02)});
$("vibrationToggle").addEventListener("change",()=>{state.settings.vibration=$("vibrationToggle").checked;saveLocal();vibrate(25)});

loadLocal();
updateOnlineStatus();
updateStartButton();
initializeVoiceInputUI();
updatePendingScoreStatus();
initAnonymousAuth();

function normalizeGameViewportAfterRotation(){
  if (!state.runActive) return;
  requestAnimationFrame(()=>{
    window.scrollTo(0,0);
  });
}

window.addEventListener("orientationchange",()=>{
  setTimeout(normalizeGameViewportAfterRotation,120);
});

window.addEventListener("resize",normalizeGameViewportAfterRotation);

if("serviceWorker" in navigator){
  window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(()=>{}));
}
})();
