(() => {
  "use strict";

  const MAX_NUMBER = 75;
  const LETTERS = ["B", "I", "N", "G", "O"];
  const RECENT_COUNT = 5;
  const STORAGE_KEY = "bingo-caller-state-v1";
  const SOUND_KEY = "bingo-caller-sound-v1";

  const SPIN_DURATION_MS = 1800;
  const SPIN_START_INTERVAL_MS = 40;
  const SPIN_END_INTERVAL_MS = 220;

  const drum = document.getElementById("drum");
  const drumLetter = document.getElementById("drum-letter");
  const drumNumber = document.getElementById("drum-number");
  const recentEl = document.getElementById("recent");
  const boardEl = document.getElementById("board");
  const drawButton = document.getElementById("draw-button");
  const resetButton = document.getElementById("reset-button");
  const drawnCountEl = document.getElementById("drawn-count");
  const remainingCountEl = document.getElementById("remaining-count");
  const soundButton = document.getElementById("sound-button");

  // 抽選済み番号（抽選順）
  let drawn = loadState();
  let spinning = false;
  let soundOn = localStorage.getItem(SOUND_KEY) !== "off";

  // ---- 効果音（Web Audio API で合成・音声ファイル不使用） ----

  let audioCtx = null;
  let noiseBuffer = null;

  function ensureAudio() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (!audioCtx) {
      audioCtx = new Ctx();
      // 1秒分のホワイトノイズ（スネア・シンバルの素）
      noiseBuffer = audioCtx.createBuffer(1, audioCtx.sampleRate, audioCtx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    return audioCtx;
  }

  function playRollStroke(time, volume) {
    // スネアワイヤー: 高域ノイズ。減衰を打点間隔より長くして前後の打音と重ね、
    // 粒が聞こえない連続したロールにする
    const wire = audioCtx.createBufferSource();
    wire.buffer = noiseBuffer;
    const wireFilter = audioCtx.createBiquadFilter();
    wireFilter.type = "bandpass";
    wireFilter.frequency.value = 4000;
    wireFilter.Q.value = 0.5;
    const wireGain = audioCtx.createGain();
    wireGain.gain.setValueAtTime(volume, time);
    wireGain.gain.exponentialRampToValueAtTime(0.001, time + 0.09);
    wire.connect(wireFilter);
    wireFilter.connect(wireGain);
    wireGain.connect(audioCtx.destination);
    wire.start(time);
    wire.stop(time + 0.1);

    // 胴鳴り: 低域の短いトーンで太鼓らしい厚みを足す
    const body = audioCtx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(220, time);
    body.frequency.exponentialRampToValueAtTime(170, time + 0.05);
    const bodyGain = audioCtx.createGain();
    bodyGain.gain.setValueAtTime(volume * 0.35, time);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
    body.connect(bodyGain);
    bodyGain.connect(audioCtx.destination);
    body.start(time);
    body.stop(time + 0.06);
  }

  function playDrumRoll(durationMs) {
    if (!soundOn || !ensureAudio()) return;
    const start = audioCtx.currentTime + 0.02;
    const duration = durationMs / 1000;
    // 約33Hzの高速連打（バズロール）。タイミングと音量に微小なゆらぎを入れて
    // 機械的な印象を消す。小さく始めて終盤に強くなるクレッシェンド
    let t = 0;
    while (t < duration) {
      const progress = t / duration;
      const crescendo = 0.06 + 0.3 * progress * progress;
      const volume = crescendo * (0.9 + Math.random() * 0.2);
      playRollStroke(start + t, volume);
      t += 0.03 + (Math.random() - 0.5) * 0.006;
    }
  }

  function playCymbal(time, volume, decay) {
    const cymbal = audioCtx.createBufferSource();
    cymbal.buffer = noiseBuffer;
    const highpass = audioCtx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 5000;
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
    cymbal.connect(highpass);
    highpass.connect(gain);
    gain.connect(audioCtx.destination);
    cymbal.start(time);
    cymbal.stop(time + decay + 0.1);
  }

  // ブラス風の和音スタブ1発（「ジャ」）
  function playBrassStab(time, duration, volume) {
    // C メジャー（C3 ベース + C4/E4/G4/C5）。±6セントのデチューンで厚みを出す
    const freqs = [130.81, 261.63, 329.63, 392.0, 523.25];
    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.setValueAtTime(3200, time);
    lowpass.frequency.exponentialRampToValueAtTime(1200, time + duration);
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, time);
    master.gain.exponentialRampToValueAtTime(volume, time + 0.02);
    // 長い音は少しホールドしてから減衰させ、「ジャーン」の余韻を出す
    const holdEnd = time + Math.min(0.3, duration * 0.25);
    master.gain.exponentialRampToValueAtTime(volume * 0.5, holdEnd);
    master.gain.exponentialRampToValueAtTime(0.001, time + duration);
    lowpass.connect(master);
    master.connect(audioCtx.destination);

    freqs.forEach((freq) => {
      [-6, 6].forEach((cents) => {
        const osc = audioCtx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq;
        osc.detune.value = cents;
        const oscGain = audioCtx.createGain();
        oscGain.gain.value = freq < 200 ? 0.09 : 0.05;
        osc.connect(oscGain);
        oscGain.connect(lowpass);
        osc.start(time);
        osc.stop(time + duration + 0.05);
      });
    });

    // 胴打ち（アタックの「ドン」）
    const thump = audioCtx.createOscillator();
    thump.type = "sine";
    thump.frequency.setValueAtTime(150, time);
    thump.frequency.exponentialRampToValueAtTime(60, time + 0.09);
    const thumpGain = audioCtx.createGain();
    thumpGain.gain.setValueAtTime(volume * 0.9, time);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);
    thump.connect(thumpGain);
    thumpGain.connect(audioCtx.destination);
    thump.start(time);
    thump.stop(time + 0.13);
  }

  // 「ジャジャン！」: 短い1打目 + 長く伸ばす2打目 + シンバル
  function playFanfare() {
    if (!soundOn || !ensureAudio()) return;
    const now = audioCtx.currentTime;
    playBrassStab(now, 0.16, 0.5);
    playCymbal(now, 0.12, 0.25);
    playBrassStab(now + 0.21, 1.3, 0.55);
    playCymbal(now + 0.21, 0.3, 1.2);
  }

  function toggleSound() {
    soundOn = !soundOn;
    try {
      localStorage.setItem(SOUND_KEY, soundOn ? "on" : "off");
    } catch {
      // 保存できなくても切り替え自体は有効
    }
    renderSoundButton();
  }

  function renderSoundButton() {
    soundButton.textContent = soundOn ? "🔊 効果音 ON" : "🔇 効果音 OFF";
    soundButton.setAttribute("aria-pressed", String(soundOn));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const seen = new Set();
      return parsed.filter(
        (n) => Number.isInteger(n) && n >= 1 && n <= MAX_NUMBER && !seen.has(n) && seen.add(n)
      );
    } catch {
      return [];
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(drawn));
    } catch {
      // プライベートモード等で保存できなくてもゲームは続行できる
    }
  }

  function letterFor(number) {
    return LETTERS[Math.floor((number - 1) / 15)];
  }

  function remainingNumbers() {
    const drawnSet = new Set(drawn);
    const rest = [];
    for (let n = 1; n <= MAX_NUMBER; n++) {
      if (!drawnSet.has(n)) rest.push(n);
    }
    return rest;
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    LETTERS.forEach((letter, col) => {
      const colEl = document.createElement("div");
      colEl.className = "board-col";

      const letterEl = document.createElement("div");
      letterEl.className = `board-letter letter-${letter}`;
      letterEl.textContent = letter;
      colEl.appendChild(letterEl);

      for (let i = 1; i <= 15; i++) {
        const number = col * 15 + i;
        const cell = document.createElement("div");
        cell.className = "board-cell";
        cell.dataset.number = String(number);
        cell.textContent = String(number);
        colEl.appendChild(cell);
      }
      boardEl.appendChild(colEl);
    });
  }

  function showOnDrum(number) {
    if (number === null) {
      drumLetter.textContent = " ";
      drumLetter.className = "drum-letter";
      drumNumber.textContent = "--";
      return;
    }
    const letter = letterFor(number);
    drumLetter.textContent = letter;
    drumLetter.className = `drum-letter letter-${letter}`;
    drumNumber.textContent = String(number);
  }

  function render() {
    const latest = drawn.length > 0 ? drawn[drawn.length - 1] : null;

    drawnCountEl.textContent = String(drawn.length);
    remainingCountEl.textContent = String(MAX_NUMBER - drawn.length);

    if (!spinning) showOnDrum(latest);

    // 直近チップ（最新が先頭）
    recentEl.innerHTML = "";
    drawn
      .slice(-RECENT_COUNT)
      .reverse()
      .forEach((n, i) => {
        const chip = document.createElement("span");
        chip.className = "recent-chip" + (i === 0 ? " latest" : "");
        chip.textContent = String(n);
        recentEl.appendChild(chip);
      });

    // ボード
    const drawnSet = new Set(drawn);
    boardEl.querySelectorAll(".board-cell").forEach((cell) => {
      const n = Number(cell.dataset.number);
      cell.classList.toggle("hit", drawnSet.has(n));
      cell.classList.toggle("latest", n === latest);
    });

    const finished = drawn.length >= MAX_NUMBER;
    drawButton.disabled = spinning || finished;
    drawButton.textContent = finished ? "全番号 終了！" : "抽選する";
  }

  function draw() {
    if (spinning) return;
    const rest = remainingNumbers();
    if (rest.length === 0) return;

    const picked = rest[Math.floor(Math.random() * rest.length)];
    spinning = true;
    drum.classList.add("spinning");
    drum.classList.remove("settled");
    playDrumRoll(SPIN_DURATION_MS);
    render();

    const start = performance.now();

    // 確定は setTimeout で保証する（タブが非表示だと rAF が止まるため）
    setTimeout(() => settle(picked), SPIN_DURATION_MS);

    function tick(now) {
      if (!spinning) return;
      // だんだん減速するルーレット表示（表示のみ・結果は確定済み）
      const progress = Math.min((now - start) / SPIN_DURATION_MS, 1);
      const interval =
        SPIN_START_INTERVAL_MS +
        (SPIN_END_INTERVAL_MS - SPIN_START_INTERVAL_MS) * progress * progress;
      showOnDrum(rest[Math.floor(Math.random() * rest.length)]);
      setTimeout(() => requestAnimationFrame(tick), interval);
    }
    requestAnimationFrame(tick);
  }

  function settle(picked) {
    drawn.push(picked);
    saveState();
    spinning = false;
    drum.classList.remove("spinning");
    drum.classList.add("settled");
    playFanfare();
    render();
  }

  function reset() {
    if (spinning) return;
    if (drawn.length > 0 && !confirm("抽選履歴をすべて消してリセットします。よろしいですか？")) {
      return;
    }
    drawn = [];
    saveState();
    drum.classList.remove("settled");
    render();
  }

  drawButton.addEventListener("click", draw);
  resetButton.addEventListener("click", reset);
  soundButton.addEventListener("click", toggleSound);
  document.addEventListener("keydown", (e) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      document.activeElement !== resetButton &&
      document.activeElement !== soundButton
    ) {
      e.preventDefault();
      draw();
    }
  });

  buildBoard();
  renderSoundButton();
  render();
})();
