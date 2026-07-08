(() => {
  "use strict";

  const MAX_NUMBER = 75;
  const LETTERS = ["B", "I", "N", "G", "O"];
  const RECENT_COUNT = 5;
  const STORAGE_KEY = "bingo-caller-state-v1";

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

  // 抽選済み番号（抽選順）
  let drawn = loadState();
  let spinning = false;

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
    render();

    const start = performance.now();

    function tick(now) {
      const elapsed = now - start;
      if (elapsed >= SPIN_DURATION_MS) {
        settle(picked);
        return;
      }
      // だんだん減速するルーレット表示（表示のみ・結果は確定済み）
      const progress = elapsed / SPIN_DURATION_MS;
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
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.repeat && document.activeElement !== resetButton) {
      e.preventDefault();
      draw();
    }
  });

  buildBoard();
  render();
})();
