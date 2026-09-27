/* ---- Layout generation (ported from the FastAPI backend's app.py so this
   page can run as a static site with no server) ---- */

const STAGE_W = 2600;
const STAGE_H = 1733;
const BIRDS_PER_SPECIES = 5;

const SPECIES = [
  ["cardinal", "Northern Cardinal"],
  ["blue_jay", "Blue Jay"],
  ["robin", "American Robin"],
  ["bald_eagle", "Bald Eagle"],
  ["mallard", "Mallard"],
  ["barn_owl", "Barn Owl"],
  ["peacock", "Indian Peafowl"],
  ["flamingo", "American Flamingo"],
  ["toucan", "Keel-billed Toucan"],
  ["macaw", "Scarlet Macaw"],
  ["woodpecker", "Downy Woodpecker"],
  ["hummingbird", "Ruby-throated Hummingbird"],
  ["sparrow", "House Sparrow"],
  ["crow", "American Crow"],
  ["pigeon", "Rock Dove"],
  ["kingfisher", "Belted Kingfisher"],
  ["swan", "Mute Swan"],
  ["penguin", "Emperor Penguin"],
  ["ostrich", "Common Ostrich"],
  ["owl", "Great Horned Owl"],
];

// Small seeded PRNG so the tree grid is stable across reloads (mirrors the
// Python backend's random.Random(20260927) for the fixed tree layout).
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildTreePositions() {
  const rng = mulberry32(20260927);
  const cols = 5, rows = 4, margin = 170;
  const cellW = (STAGE_W - 2 * margin) / cols;
  const cellH = (STAGE_H - 2 * margin) / rows;
  const positions = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = margin + cellW * (c + 0.5) + (rng() * 2 - 1) * 0.28 * cellW;
      const cy = margin + cellH * (r + 0.5) + (rng() * 2 - 1) * 0.28 * cellH;
      positions.push([cx, cy]);
    }
  }
  return positions;
}

const TREE_POSITIONS = buildTreePositions();

function buildBirdCells() {
  const cols = 22, rows = 15;
  const cw = STAGE_W / cols, ch = STAGE_H / rows;
  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = cw * (c + 0.5), cy = ch * (r + 0.5);
      if (cx < 70 || cx > STAGE_W - 70 || cy < 70 || cy > STAGE_H - 70) continue;
      let tooClose = false;
      for (const [tx, ty] of TREE_POSITIONS) {
        if ((cx - tx) ** 2 + (cy - ty) ** 2 < 150 ** 2) { tooClose = true; break; }
      }
      if (!tooClose) cells.push([cx, cy, cw, ch]);
    }
  }
  return cells;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateGame() {
  const speciesOrder = shuffle(SPECIES.slice());
  const trees = speciesOrder.map(([slug, name], i) => {
    const [x, y] = TREE_POSITIONS[i];
    return {
      id: `tree-${i}`,
      species: slug,
      name,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      sign_image: `images/birds/${slug}.jpg`,
    };
  });

  const cells = shuffle(buildBirdCells());
  const needed = SPECIES.length * BIRDS_PER_SPECIES;
  const chosen = cells.slice(0, needed);

  let instances = [];
  for (const pair of SPECIES) {
    for (let i = 0; i < BIRDS_PER_SPECIES; i++) instances.push(pair);
  }
  instances = shuffle(instances);

  const birds = instances.map(([slug, name], i) => {
    const [cx, cy, cw, ch] = chosen[i];
    const x = cx + (Math.random() * 2 - 1) * 0.3 * cw;
    const y = cy + (Math.random() * 2 - 1) * 0.3 * ch;
    return {
      id: `bird-${i}`,
      species: slug,
      name,
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      image: `images/birds/${slug}.jpg`,
    };
  });

  return {
    stage: { width: STAGE_W, height: STAGE_H, background: "images/forest_background.jpg" },
    trees,
    birds,
  };
}

/* ---- Game UI (same interaction logic as the FastAPI version) ---- */

const stage = document.getElementById("stage");
const flash = document.getElementById("flash-overlay");
const matchedEl = document.getElementById("matched-count");
const mistakeEl = document.getElementById("mistake-count");
const timerEl = document.getElementById("timer");
const hintEl = document.getElementById("hint");
const winModal = document.getElementById("win-modal");
const winStats = document.getElementById("win-stats");

const DEFAULT_HINT = "Click a tree, then click the bird that matches its sign.";

// Perch slots a matched bird flies to, relative to its tree's (x, y) anchor.
const PERCH_OFFSETS = [
  [-45, -150], [-18, -178], [12, -182], [40, -162], [58, -125],
];

let state = null;
let hintTimeout = null;

function loadGame() {
  const data = generateGame();
  renderGame(data);
}

function renderGame(data) {
  stage.style.width = data.stage.width + "px";
  stage.style.height = data.stage.height + "px";
  stage.style.backgroundImage = `url(${data.stage.background})`;

  stage.querySelectorAll(".tree, .bird").forEach((el) => el.remove());

  if (state && state.timerHandle) clearInterval(state.timerHandle);
  state = {
    trees: {},
    birds: {},
    selectedTreeId: null,
    matched: 0,
    mistakes: 0,
    total: data.birds.length,
    startTime: null,
    timerHandle: null,
  };

  for (const t of data.trees) {
    const el = document.createElement("div");
    el.className = "tree";
    el.style.left = t.x + "px";
    el.style.top = t.y + "px";
    el.innerHTML =
      '<div class="canopy"></div><div class="trunk"></div>' +
      `<img class="sign" src="${t.sign_image}" alt="${t.name}">`;
    el.addEventListener("click", () => onTreeClick(t.id));
    stage.appendChild(el);
    state.trees[t.id] = { ...t, el, matchedCount: 0 };
  }

  for (const b of data.birds) {
    const img = document.createElement("img");
    img.className = "bird";
    img.src = b.image;
    img.alt = b.name;
    img.style.left = b.x + "px";
    img.style.top = b.y + "px";
    img.addEventListener("click", () => onBirdClick(b.id));
    stage.appendChild(img);
    state.birds[b.id] = { ...b, el: img, matched: false };
  }

  timerEl.textContent = "Time: 0:00";
  winModal.classList.add("hidden");
  updateHud();
  startTimer();
}

function onTreeClick(treeId) {
  const tree = state.trees[treeId];
  if (tree.matchedCount >= 5) return;
  for (const id in state.trees) state.trees[id].el.classList.remove("selected");
  state.selectedTreeId = treeId;
  tree.el.classList.add("selected");
}

function onBirdClick(birdId) {
  const bird = state.birds[birdId];
  if (bird.matched) return;
  if (!state.selectedTreeId) {
    flashMessage("Select a tree first!");
    return;
  }
  const tree = state.trees[state.selectedTreeId];
  if (bird.species === tree.species) {
    correctMatch(bird, tree);
  } else {
    wrongMatch(bird);
  }
}

function correctMatch(bird, tree) {
  flashScreen("green");
  const [dx, dy] = PERCH_OFFSETS[Math.min(tree.matchedCount, PERCH_OFFSETS.length - 1)];
  bird.el.style.left = tree.x + dx + "px";
  bird.el.style.top = tree.y + dy + "px";
  bird.el.classList.add("landed");
  bird.matched = true;
  tree.matchedCount += 1;
  state.matched += 1;

  if (tree.matchedCount >= 5) {
    tree.el.classList.remove("selected");
    tree.el.classList.add("complete");
    state.selectedTreeId = null;
  }

  updateHud();
  if (state.matched >= state.total) finishGame();
}

function wrongMatch(bird) {
  flashScreen("red");
  state.mistakes += 1;
  bird.el.classList.add("wrong-shake");
  setTimeout(() => bird.el.classList.remove("wrong-shake"), 400);
  updateHud();
}

function flashScreen(color) {
  flash.className = color;
  setTimeout(() => { flash.className = ""; }, 350);
}

function flashMessage(text) {
  hintEl.textContent = text;
  hintEl.classList.add("alert");
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => {
    hintEl.textContent = DEFAULT_HINT;
    hintEl.classList.remove("alert");
  }, 1600);
}

function updateHud() {
  matchedEl.textContent = `Matched: ${state.matched} / ${state.total}`;
  mistakeEl.textContent = `Mistakes: ${state.mistakes}`;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function startTimer() {
  if (state.startTime !== null) return;
  state.startTime = Date.now();
  state.timerHandle = setInterval(() => {
    const secs = Math.floor((Date.now() - state.startTime) / 1000);
    timerEl.textContent = `Time: ${formatTime(secs)}`;
  }, 1000);
}

function finishGame() {
  clearInterval(state.timerHandle);
  const secs = Math.floor((Date.now() - state.startTime) / 1000);
  winStats.textContent = `Time: ${formatTime(secs)} — Mistakes: ${state.mistakes}`;
  winModal.classList.remove("hidden");
}

document.getElementById("restart-btn").addEventListener("click", loadGame);
document.getElementById("win-restart-btn").addEventListener("click", loadGame);

loadGame();
