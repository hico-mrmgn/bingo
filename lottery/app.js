(() => {
  "use strict";

  const STORAGE_KEY = "prize-lottery-state-v1";
  const SOUND_KEY = "prize-lottery-sound-v1";

  const SPIN_DURATION_MS = 2000;
  const SPIN_START_INTERVAL_MS = 60;
  const SPIN_END_INTERVAL_MS = 280;

  const DEFAULT_PRIZES = [
    { name: "1等 豪華賞品", total: 1 },
    { name: "2等 すてきな賞品", total: 2 },
    { name: "3等 お楽しみ賞品", total: 3 },
  ];

  const ticket = document.getElementById("ticket");
  const ticketLabel = document.getElementById("ticket-label");
  const ticketPrize = document.getElementById("ticket-prize");
  const remainingCountEl = document.getElementById("remaining-count");
  const prizeListEl = document.getElementById("prize-list");
  const historyListEl = document.getElementById("history-list");
  const drawButton = document.getElementById("draw-button");
  const soundButton = document.getElementById("sound-button");
  const editButton = document.getElementById("edit-button");
  const resetButton = document.getElementById("reset-button");
  const editDialog = document.getElementById("edit-dialog");
  const editTextarea = document.getElementById("edit-textarea");

  // 景品リストと当選履歴（当選順の景品名）
  let state = loadState();
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

  // ---- 状態管理 ----

  function sanitizePrizes(raw) {
    if (!Array.isArray(raw)) return null;
    const merged = new Map();
    for (const p of raw) {
      if (!p || typeof p.name !== "string") continue;
      const name = p.name.trim();
      const total = Number(p.total);
      if (!name || !Number.isInteger(total) || total < 1) continue;
      merged.set(name, (merged.get(name) || 0) + total);
    }
    if (merged.size === 0) return null;
    return [...merged].map(([name, total]) => ({ name, total }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      const prizes = sanitizePrizes(parsed.prizes);
      if (!prizes) return defaultState();
      const names = new Set(prizes.map((p) => p.name));
      const history = Array.isArray(parsed.history)
        ? parsed.history.filter((n) => names.has(n))
        : [];
      return { prizes, history };
    } catch {
      return defaultState();
    }
  }

  function defaultState() {
    return { prizes: DEFAULT_PRIZES.map((p) => ({ ...p })), history: [] };
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // プライベートモード等で保存できなくてもゲームは続行できる
    }
  }

  function wonCount(name) {
    return state.history.filter((n) => n === name).length;
  }

  function remainingOf(prize) {
    return Math.max(0, prize.total - wonCount(prize.name));
  }

  // 残っているクジを1本ずつ並べた配列（本数分の重み付き抽選になる）
  function remainingTickets() {
    const tickets = [];
    for (const prize of state.prizes) {
      for (let i = 0; i < remainingOf(prize); i++) tickets.push(prize.name);
    }
    return tickets;
  }

  // ---- 描画 ----

  function showPrize(name) {
    if (name === null) {
      ticketPrize.textContent = "？";
      ticketPrize.classList.remove("long");
      return;
    }
    ticketPrize.textContent = name;
    ticketPrize.classList.toggle("long", name.length > 8);
  }

  function render() {
    const tickets = remainingTickets();
    const latest = state.history.length > 0 ? state.history[state.history.length - 1] : null;

    remainingCountEl.textContent = String(tickets.length);

    if (!spinning) {
      showPrize(latest);
      ticketLabel.textContent = latest === null
        ? "ビンゴおめでとう！クジを引いてね"
        : "おめでとうございます！";
    }

    // 景品リスト（残数付き）
    prizeListEl.innerHTML = "";
    state.prizes.forEach((prize, i) => {
      const remaining = remainingOf(prize);
      const li = document.createElement("li");
      li.className = "prize-item" + (remaining === 0 ? " out" : "");

      const dot = document.createElement("span");
      dot.className = `prize-dot dot-${i % 5}`;
      const name = document.createElement("span");
      name.className = "prize-name";
      name.textContent = prize.name;
      const count = document.createElement("span");
      count.className = "prize-count";
      count.textContent = `${remaining} / ${prize.total}`;

      li.append(dot, name, count);
      prizeListEl.appendChild(li);
    });

    // 当選履歴（最新が先頭）
    historyListEl.innerHTML = "";
    state.history
      .map((name, i) => ({ name, order: i + 1 }))
      .reverse()
      .forEach(({ name, order }, i) => {
        const li = document.createElement("li");
        li.className = "history-item" + (i === 0 ? " latest" : "");
        const orderEl = document.createElement("span");
        orderEl.className = "history-order";
        orderEl.textContent = `${order}本目`;
        const nameEl = document.createElement("span");
        nameEl.textContent = name;
        li.append(orderEl, nameEl);
        historyListEl.appendChild(li);
      });

    const finished = tickets.length === 0;
    drawButton.disabled = spinning || finished;
    drawButton.textContent = finished ? "クジは終了！" : "クジを引く";
  }

  // ---- 抽選 ----

  function draw() {
    if (spinning || editDialog.open) return;
    const tickets = remainingTickets();
    if (tickets.length === 0) return;

    const picked = tickets[Math.floor(Math.random() * tickets.length)];
    spinning = true;
    ticket.classList.add("spinning");
    ticket.classList.remove("settled");
    ticketLabel.textContent = "何が当たるかな…？";
    playDrumRoll(SPIN_DURATION_MS);
    render();

    const start = performance.now();
    // 残っている景品名をシャッフル表示する候補（重複を除く）
    const candidates = [...new Set(tickets)];

    // 確定は setTimeout で保証する（タブが非表示だと rAF が止まるため）
    setTimeout(() => settle(picked), SPIN_DURATION_MS);

    function tick(now) {
      if (!spinning) return;
      // だんだん減速するルーレット表示（表示のみ・結果は確定済み）
      const progress = Math.min((now - start) / SPIN_DURATION_MS, 1);
      const interval =
        SPIN_START_INTERVAL_MS +
        (SPIN_END_INTERVAL_MS - SPIN_START_INTERVAL_MS) * progress * progress;
      showPrize(candidates[Math.floor(Math.random() * candidates.length)]);
      setTimeout(() => requestAnimationFrame(tick), interval);
    }
    requestAnimationFrame(tick);
  }

  function settle(picked) {
    state.history.push(picked);
    saveState();
    spinning = false;
    ticket.classList.remove("spinning");
    ticket.classList.add("settled");
    playFanfare();
    render();
  }

  function reset() {
    if (spinning) return;
    if (
      state.history.length > 0 &&
      !confirm("当選履歴を消して、クジを全部箱に戻します。よろしいですか？")
    ) {
      return;
    }
    state.history = [];
    saveState();
    ticket.classList.remove("settled");
    render();
  }

  // ---- 景品リスト編集 ----

  function openEditor() {
    if (spinning) return;
    editTextarea.value = state.prizes.map((p) => `${p.name} x${p.total}`).join("\n");
    editDialog.showModal();
  }

  // 「景品名 x本数」を1行ずつ解釈する。x本数 省略時は1本、同名はまとめる
  function parsePrizeText(text) {
    const merged = new Map();
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const match = trimmed.match(/^(.*?)(?:\s+[x×]\s*(\d+))?$/i);
      const name = match[1].trim();
      if (!name) continue;
      const count = match[2] ? Number(match[2]) : 1;
      if (count < 1) continue;
      merged.set(name, (merged.get(name) || 0) + count);
    }
    return [...merged].map(([name, total]) => ({ name, total }));
  }

  editDialog.addEventListener("close", () => {
    if (editDialog.returnValue !== "save") return;
    const prizes = parsePrizeText(editTextarea.value);
    if (prizes.length === 0) {
      alert("景品が1つもありません。変更は保存されませんでした。");
      return;
    }
    const names = new Set(prizes.map((p) => p.name));
    state = {
      prizes,
      // リストから消えた景品の履歴も残すと残数計算が狂うため、現存する景品の履歴のみ残す
      history: state.history.filter((n) => names.has(n)),
    };
    saveState();
    render();
  });

  drawButton.addEventListener("click", draw);
  resetButton.addEventListener("click", reset);
  soundButton.addEventListener("click", toggleSound);
  editButton.addEventListener("click", openEditor);
  document.addEventListener("keydown", (e) => {
    if (
      e.code === "Space" &&
      !e.repeat &&
      !editDialog.open &&
      document.activeElement !== resetButton &&
      document.activeElement !== soundButton &&
      document.activeElement !== editButton
    ) {
      e.preventDefault();
      draw();
    }
  });

  renderSoundButton();
  render();
})();
