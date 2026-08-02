/**
 * Wordle AI Auto-Solver Content Script
 * Powered by Datamuse API & Shannon Entropy Engine
 */

const STATE_MAP = {
  correct: "G",
  present: "Y",
  absent: "B"
};

const TOP_OPENERS = [
  "CRANE", "SLATE", "STARE", "ROATE", "RAISE",
  "TRACE", "SNARE", "ARISE", "SALET", "TALER"
];

let isSolving = false;

// Listen for messages from extension popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'START_SOLVER' && !isSolving) {
    runSolver();
    sendResponse({ status: 'started' });
  }
});

// Auto-run if page loads directly
if (document.readyState === 'complete') {
  initAutoRun();
} else {
  window.addEventListener('load', initAutoRun);
}

function initAutoRun() {
  // If user clicked extension before load finished
  setTimeout(dismissModals, 1000);
}

async function runSolver() {
  if (isSolving) return;
  isSolving = true;
  console.log("🚀 Wordle AI Auto-Solver initiated...");

  await dismissModals();
  await sleep(1000);

  if (isAlreadyCompleted()) {
    console.log("Notice: Today's Wordle has already been completed!");
    isSolving = false;
    return;
  }

  const existingHistory = getExistingHistory();
  const history = [...existingHistory];
  const rejectedWords = new Set();

  let turn = history.length;

  while (turn < 6) {
    console.log(`--- Turn ${turn + 1} ---`);
    const patternStr = buildPattern(history);
    console.log(`Fetching candidates matching pattern: "${patternStr}"`);

    const rawCandidates = await fetchDatamuseWords(patternStr);
    
    // Enforce yellow/gray history constraints and filter out rejected words
    const candidates = rawCandidates.filter(c => 
      !rejectedWords.has(c) && 
      history.every(([g, fb]) => getFeedback(g, c) === fb)
    );

    if (candidates.length === 0) {
      console.warn("No live candidates satisfy constraints!");
      alert("No candidate words found matching current clues.");
      isSolving = false;
      return;
    }

    let guess;
    if (turn === 0) {
      const validOpeners = TOP_OPENERS.filter(w => candidates.includes(w));
      guess = validOpeners.length > 0 
        ? validOpeners[Math.floor(Math.random() * validOpeners.length)] 
        : bestGuess(candidates);
    } else {
      guess = bestGuess(candidates);
    }

    if (!guess) {
      console.warn("No guess selected!");
      isSolving = false;
      return;
    }

    console.log(`Bot guessing: ${guess} (${candidates.length} candidates left)`);
    await typeGuess(guess);
    await sleep(2500);

    // Check if Wordle rejected the guess (row didn't flip)
    if (isRowRejected(turn)) {
      console.warn(`Word '${guess}' was not accepted by Wordle! Clearing row...`);
      await clearRow();
      rejectedWords.add(guess);
      continue; // retry turn
    }

    const fb = readFeedback(turn);
    console.log(`Feedback for ${guess}: ${fb}`);

    if (!fb) {
      console.error("Failed to read feedback!");
      isSolving = false;
      return;
    }

    if (fb === "GGGGG") {
      console.log(`🎉 Solved in ${turn + 1} guesses!`);
      isSolving = false;
      return;
    }

    history.push([guess, fb]);
    turn++;
  }

  console.log("Game finished!");
  isSolving = false;
}

// Helper: Fetch candidates from Datamuse API
async function fetchDatamuseWords(pattern) {
  try {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(pattern)}&max=1000`;
    const res = await fetch(url);
    const data = await res.json();
    return data
      .map(d => d.word.toUpperCase())
      .filter(w => w.length === 5 && /^[A-Z]+$/.test(w));
  } catch (err) {
    console.error("Datamuse API error:", err);
    return [];
  }
}

// Helper: Build wildcard pattern for Datamuse (e.g. ?RA?E)
function buildPattern(history) {
  const pattern = ["?", "?", "?", "?", "?"];
  for (const [guess, fb] of history) {
    for (let i = 0; i < 5; i++) {
      if (fb[i] === "G") {
        pattern[i] = guess[i];
      }
    }
  }
  return pattern.join("");
}

// Helper: Simulate Wordle feedback (GYB)
function getFeedback(guess, answer) {
  const result = ["B", "B", "B", "B", "B"];
  const remaining = answer.split("");

  // Pass 1: Greens
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "G";
      remaining[i] = null;
    }
  }

  // Pass 2: Yellows
  for (let i = 0; i < 5; i++) {
    if (result[i] === "G") continue;
    const idx = remaining.indexOf(guess[i]);
    if (idx !== -1) {
      result[i] = "Y";
      remaining[idx] = null;
    }
  }

  return result.join("");
}

// Helper: Shannon Entropy Calculation
function calculateEntropy(guess, candidates) {
  const patternCounts = {};
  for (const target of candidates) {
    const pattern = getFeedback(guess, target);
    patternCounts[pattern] = (patternCounts[pattern] || 0) + 1;
  }

  const total = candidates.length;
  let ent = 0.0;
  for (const count of Object.values(patternCounts)) {
    const p = count / total;
    ent -= p * Math.log2(p);
  }
  return ent;
}

function bestGuess(candidates) {
  if (candidates.length === 1) return candidates[0];
  let bestWord = null;
  let bestScore = -1.0;

  const pool = candidates.length <= 40 ? candidates : candidates.slice(0, 150);
  for (const word of pool) {
    const score = calculateEntropy(word, candidates);
    if (score > bestScore) {
      bestWord = word;
      bestScore = score;
    }
  }
  return bestWord || candidates[0];
}

// DOM Helper: Dismiss cookie & welcome modals
async function dismissModals() {
  // Cookie banner
  const cookieBanner = document.querySelector("#fides-banner");
  if (cookieBanner) {
    const btn = Array.from(cookieBanner.querySelectorAll("button"))
      .find(b => ["accept all", "accept", "continue"].includes(b.innerText.trim().toLowerCase()));
    if (btn) {
      btn.click();
      await sleep(500);
    }
  }

  // Play button
  const playBtn = document.querySelector('[data-testid="Play"]');
  if (playBtn) {
    playBtn.click();
    await sleep(500);
  }

  // Welcome Back Continue button
  const continueBtns = Array.from(document.querySelectorAll('button'))
    .filter(b => b.innerText.trim().toLowerCase() === "continue");
  for (const b of continueBtns) {
    if (b.offsetWidth > 0 && b.offsetHeight > 0) {
      b.click();
      await sleep(500);
    }
  }

  // Close tutorial dialog
  const closeBtn = document.querySelector('button[aria-label="Close"]') || document.querySelector('[data-testid="icon-close"]');
  if (closeBtn) {
    closeBtn.click();
    await sleep(500);
  }
}

// DOM Helper: Type guess via key events
async function typeGuess(word) {
  for (const char of word) {
    dispatchKey(char);
    await sleep(100);
  }
  dispatchKey("Enter");
}

async function clearRow() {
  for (let i = 0; i < 5; i++) {
    dispatchKey("Backspace");
    await sleep(80);
  }
}

function dispatchKey(key) {
  const event = new KeyboardEvent("keydown", {
    key: key,
    code: key === "Enter" ? "Enter" : key === "Backspace" ? "Backspace" : `Key${key.toUpperCase()}`,
    bubbles: true,
    cancelable: true
  });
  document.dispatchEvent(event);
}

// DOM Helper: Read tile states for row
function readFeedback(turnIndex) {
  const rows = document.querySelectorAll('div[class*="Row-module_row__"]');
  if (!rows[turnIndex]) return null;

  const tiles = rows[turnIndex].querySelectorAll('[data-testid="tile"]');
  if (tiles.length !== 5) return null;

  let feedback = "";
  for (let i = 0; i < 5; i++) {
    const state = tiles[i].getAttribute("data-state");
    feedback += STATE_MAP[state] || "B";
  }
  return feedback;
}

function isRowRejected(turnIndex) {
  const rows = document.querySelectorAll('div[class*="Row-module_row__"]');
  if (!rows[turnIndex]) return true;

  const tiles = rows[turnIndex].querySelectorAll('[data-testid="tile"]');
  if (tiles.length !== 5) return true;

  const states = Array.from(tiles).map(t => t.getAttribute("data-state"));
  return !states.some(s => ["correct", "present", "absent"].includes(s));
}

function getExistingHistory() {
  const history = [];
  const rows = document.querySelectorAll('div[class*="Row-module_row__"]');
  
  for (let i = 0; i < rows.length; i++) {
    const tiles = rows[i].querySelectorAll('[data-testid="tile"]');
    if (tiles.length !== 5) break;

    let word = "";
    let pattern = "";
    let isValidRow = true;

    for (let t = 0; t < 5; t++) {
      const char = tiles[t].innerText.trim().toUpperCase();
      const state = tiles[t].getAttribute("data-state");

      if (!char || !STATE_MAP[state]) {
        isValidRow = false;
        break;
      }

      word += char;
      pattern += STATE_MAP[state];
    }

    if (isValidRow && word.length === 5) {
      history.append ? history.push([word, pattern]) : history.push([word, pattern]);
    } else {
      break;
    }
  }

  return history;
}

function isAlreadyCompleted() {
  const stats = document.querySelector('h2');
  if (stats && stats.innerText.includes("STATISTICS")) return true;

  const history = getExistingHistory();
  if (history.length >= 6) return True;
  return history.some(([_, p]) => p === "GGGGG");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
