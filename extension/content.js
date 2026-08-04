/**
 * Wordle AI Auto-Solver Content Script
 * Powered by Datamuse API & Shannon Entropy Engine
 */

const STATE_MAP = {
  correct: "G",
  present: "Y",
  absent: "B"
};

// Top openers combining high Shannon Entropy (math) + popular NYT Wordle Bot player choices
const TOP_OPENERS = [
  // Top Mathematical Openers (Information Theory / 3Blue1Brown / MIT benchmarks)
  "SALET", "TRACE", "CRANE", "CRATE", "SLATE",
  "STARE", "RAISE", "SNARE", "AROSE", "LEAST",
  // Top Reader/Player Picks (NYT Wordle Bot analytics)
  "ADIEU", "AUDIO", "ARISE", "HOUSE", "TRAIN",
  "IRATE", "GREAT", "HEART", "DREAM", "OCEAN"
];

// English Letter Frequency weights (used to prioritize high-yield consonants & vowels in probes)
const LETTER_WEIGHTS = {
  E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7, S: 6.3, H: 6.1, R: 6.0,
  D: 4.3, L: 4.0, C: 2.8, U: 2.8, M: 2.4, W: 2.4, F: 2.2, G: 2.0, Y: 2.0,
  P: 1.9, B: 1.5, V: 1.0, K: 0.8, J: 0.15, X: 0.15, Q: 0.1, Z: 0.07
};

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

  try {
    await dismissModals();
    await sleep(800);

    if (isAlreadyCompleted()) {
      console.log("Notice: Today's Wordle has already been completed!");
      return;
    }

    // Pre-fetch probe word pool in background
    fetchDatamuseWords('?????');

    const existingHistory = getExistingHistory();
    const history = [...existingHistory];
    const rejectedWords = new Set();

    let turn = history.length;

    while (turn < 6) {
      console.log(`--- Turn ${turn + 1} ---`);
      await quickDismissModals();
      const patternStr = buildPattern(history);
      console.log(`Fetching candidates matching pattern: "${patternStr}"`);

      const rawCandidates = await fetchDatamuseWords(patternStr);
      
      // Enforce yellow/gray history constraints and filter out rejected words
      const candidates = rawCandidates.filter(c => 
        !rejectedWords.has(c) && 
        history.every(([g, fb]) => getFeedback(g, c) === fb)
      );

      let guess;

      if (candidates.length === 0) {
        console.warn("No live candidates — switching to probe mode...");
        guess = await getProbeGuess(history, rejectedWords);
        if (!guess) {
          console.warn("Probe mode exhausted — cannot continue.");
          return;
        }
        console.log(`🔍 Probe guess: ${guess} (testing unchecked letters)`);
      } else if (turn === 0) {
        const availableOpeners = TOP_OPENERS.filter(w => !rejectedWords.has(w));
        guess = availableOpeners[Math.floor(Math.random() * availableOpeners.length)];
      } else if (turn === 1 && shouldPlayFreeGuess(history)) {
        const freeGuess = await getProbeGuess(history, rejectedWords);
        if (freeGuess) {
          guess = freeGuess;
          console.log(`🔀 Free second guess: ${guess} (opener gave only ${getUsefulLetterCount(history[0])} useful positions — probing fresh high-yield letters)`);
        } else {
          guess = await bestGuess(candidates, history, rejectedWords);
        }
      } else {
        guess = await bestGuess(candidates, history, rejectedWords);
      }

      if (!guess) {
        console.warn("No guess selected!");
        return;
      }

      console.log(`Bot guessing: ${guess} (${candidates.length} candidates left)`);
      await typeGuess(guess);
      await sleep(600);

      // Check if Wordle rejected the guess (row didn't flip)
      if (isRowRejected(turn)) {
        console.warn(`Word '${guess}' was not accepted by Wordle! Clearing row...`);
        await clearRow();
        rejectedWords.add(guess);
        continue; // retry turn
      }

      // Poll until all 5 tiles finish flipping and reveal state
      const fb = await waitForFeedback(turn);
      console.log(`Feedback for ${guess}: ${fb}`);

      if (!fb) {
        console.error("Failed to read feedback or tiles did not flip!");
        break;
      }

      if (fb === "GGGGG") {
        console.log(`🎉 Solved in ${turn + 1} guesses!`);
        return;
      }

      history.push([guess, fb]);
      turn++;
    }

    console.log("Game finished!");
  } catch (err) {
    console.error("Solver error:", err);
  } finally {
    isSolving = false;
  }
}

let cachedProbePool = null;

// Helper: Fetch candidates from Datamuse API with timeout and caching
async function fetchDatamuseWords(pattern) {
  if (pattern === '?????' && cachedProbePool && cachedProbePool.length > 0) {
    return cachedProbePool;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3500);

  try {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(pattern)}&max=1000`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const words = data
      .map(d => d.word.toUpperCase())
      .filter(w => w.length === 5 && /^[A-Z]+$/.test(w));

    if (pattern === '?????' && words.length > 0) {
      cachedProbePool = words;
    }
    return words;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("Datamuse API fetch failed or timed out, using fallback:", err);
    return cachedProbePool || TOP_OPENERS;
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

async function bestGuess(candidates, history = [], rejectedWords = new Set()) {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 2) return candidates[0]; // 50/50 chance

  let bestWord = null;
  let bestScore = -1.0;

  // 1. Evaluate candidate pool (give +0.15 bit bonus for candidate match winning immediately)
  const pool = candidates.length <= 40 ? candidates : candidates.slice(0, 150);
  for (const word of pool) {
    const score = calculateEntropy(word, candidates) + 0.15;
    if (score > bestScore) {
      bestWord = word;
      bestScore = score;
    }
  }

  // 2. If candidates >= 3 and <= 30, also evaluate non-candidate probe words
  // to break letter traps (e.g. _IGHT / _OUND clusters) in a single turn
  if (candidates.length >= 3 && candidates.length <= 30) {
    const probeCandidates = await getProbeCandidates(history, rejectedWords);
    for (const probe of probeCandidates) {
      if (candidates.includes(probe)) continue;
      const score = calculateEntropy(probe, candidates); // no bonus for non-candidates
      if (score > bestScore) {
        bestWord = probe;
        bestScore = score;
        console.log(`💡 High-entropy non-candidate probe chosen: ${probe} (splits candidate cluster efficiently)`);
      }
    }
  }

  return bestWord || candidates[0];
}

// Helper: Get letters confirmed absent (seen as B, never as G or Y).
// Handles repeated-letter edge cases: if a letter appeared as B in one
// guess but Y or G in another, it is NOT absent — the B meant "no extra copy".
function getAbsentLetters(history) {
  const present = new Set();
  const blackSeen = new Set();
  for (const [guess, fb] of history) {
    for (let i = 0; i < 5; i++) {
      if (fb[i] === 'G' || fb[i] === 'Y') {
        present.add(guess[i]);
      } else {
        blackSeen.add(guess[i]);
      }
    }
  }
  // Truly absent = appeared as B AND never as G/Y across all guesses
  return new Set([...blackSeen].filter(l => !present.has(l)));
}

// Helper: When probe mode is active, pick a valid word that tests high-frequency
// untested letters (weighted by English letter frequency).
async function getProbeGuess(history, rejectedWords = new Set()) {
  const testedLetters = new Set();
  const absentLetters = getAbsentLetters(history);

  for (const [guess] of history) {
    for (const ch of guess) testedLetters.add(ch);
  }

  const untestedLetters = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !testedLetters.has(l))
  );

  const probePool = await fetchDatamuseWords('?????');
  const validProbes = probePool.filter(word =>
    !rejectedWords.has(word) &&
    ![...word].some(ch => absentLetters.has(ch))
  );

  if (validProbes.length === 0) return null;

  // Score probe by sum of letter frequency weights of its unique untested letters
  let bestProbe = null;
  let bestScore = -1;
  for (const word of validProbes) {
    const uniqueChars = [...new Set(word.split(''))];
    const score = uniqueChars
      .filter(ch => untestedLetters.has(ch))
      .reduce((sum, ch) => sum + (LETTER_WEIGHTS[ch] || 1.0), 0);

    if (score > bestScore) {
      bestScore = score;
      bestProbe = word;
    }
  }

  return bestProbe;
}

// Helper: Get candidate probe words from Datamuse + TOP_OPENERS for entropy evaluation
async function getProbeCandidates(history, rejectedWords = new Set()) {
  const absentLetters = getAbsentLetters(history);
  const probePool = await fetchDatamuseWords('?????');
  const combined = Array.from(new Set([...probePool, ...TOP_OPENERS]));
  
  return combined.filter(word =>
    !rejectedWords.has(word) &&
    ![...word].some(ch => absentLetters.has(ch))
  ).slice(0, 60);
}

// Helper: Count green + yellow positions in the most recent [guess, feedback].
function getUsefulLetterCount([, fb]) {
  return fb.split('').filter(c => c === 'G' || c === 'Y').length;
}

// Helper: Decide whether to play a free second probe on turn 2.
// If the opener returned ≤ 2 useful positions (green or yellow), the
// candidate pool is still huge. Covering 5 brand-new letters yields
// more expected information than restricting to known constraints.
function shouldPlayFreeGuess(history) {
  if (history.length === 0) return false;
  return getUsefulLetterCount(history[0]) <= 2;
}

// DOM Helper: Dismiss cookie, privacy & welcome modals automatically
async function dismissModals() {
  let dismissed = false;

  // 1. Accept / Dismiss Privacy & Cookie Preferences
  const acceptButtons = [
    "#onetrust-accept-btn-handler",
    "#accept-all",
    "#fides-banner button",
    "button[id*='accept']",
    "button[class*='accept']"
  ];
  
  for (const selector of acceptButtons) {
    const btn = document.querySelector(selector);
    if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
      btn.click();
      dismissed = true;
      await sleep(400);
      break;
    }
  }

  // Also check buttons by text (e.g. "Accept all", "Accept", "Reject all")
  const allBtns = Array.from(document.querySelectorAll("button"));
  const privacyBtn = allBtns.find(b => {
    const txt = b.innerText.trim().toLowerCase();
    return (txt === "accept all" || txt === "accept" || txt === "reject all") && b.offsetWidth > 0 && b.offsetHeight > 0;
  });
  if (privacyBtn) {
    privacyBtn.click();
    await sleep(400);
  }

  // 2. Play button (NYT Welcome page)
  const playBtn = document.querySelector('[data-testid="Play"]') || 
                  Array.from(document.querySelectorAll("button")).find(b => b.innerText.trim().toLowerCase() === "play");
  if (playBtn && playBtn.offsetWidth > 0 && playBtn.offsetHeight > 0) {
    playBtn.click();
    await sleep(400);
  }

  // 3. Welcome Back / Continue buttons
  const continueBtns = Array.from(document.querySelectorAll('button'))
    .filter(b => ["continue", "skip"].includes(b.innerText.trim().toLowerCase()));
  for (const b of continueBtns) {
    if (b.offsetWidth > 0 && b.offsetHeight > 0) {
      b.click();
      await sleep(400);
    }
  }

  // 4. Close "How to Play", Account Promo modals, Tutorial dialogs & NYT Navigation Side Drawer
  const closeSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    'button[aria-label="Close navigation"]',
    'button[aria-label="Close menu"]',
    'button[aria-label*="close"]',
    'button[aria-label*="Close"]',
    'button[aria-label*="dismiss"]',
    'button[aria-label*="Dismiss"]',
    '[data-testid="icon-close"]',
    '[data-testid="nav-drawer-close"]',
    '[data-testid="drawer-close"]',
    '[data-testid="close-button"]',
    '[data-testid="modal-close"]',
    'button.aria-label-close',
    '.Modal-module_closeIcon__25a2G',
    '[class*="closeIcon"]',
    '[class*="CloseIcon"]',
    '[class*="closeButton"]',
    '[class*="CloseButton"]',
    '[class*="NavDrawer"] button',
    '[class*="navDrawer"] button',
    '[class*="drawer"] button[aria-label]',
    '[class*="Sidebar"] button',
    '[class*="sidebar"] button'
  ];

  for (const sel of closeSelectors) {
    try {
      const btns = document.querySelectorAll(sel);
      for (const closeBtn of btns) {
        if (isKeyboardOrBoardElement(closeBtn)) continue;
        if (closeBtn && closeBtn.offsetWidth > 0 && closeBtn.offsetHeight > 0) {
          closeBtn.click();
          dismissed = true;
          await sleep(250);
        }
      }
    } catch(e) {}
  }

  // 5. Generic Dialog & Modal Sweep: scan open dialog/modal containers for close/skip/dismiss buttons
  const dialogContainers = document.querySelectorAll('[role="dialog"], [class*="Modal"], [class*="modal"], [class*="Dialog"], [class*="dialog"], [class*="Overlay"], [class*="overlay"], [class*="popup"], [class*="Popup"]');
  for (const container of dialogContainers) {
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) continue;
    if (isKeyboardOrBoardElement(container)) continue;

    const clickableElements = Array.from(container.querySelectorAll('button, svg, a, div[role="button"], span[role="button"]'));
    for (const el of clickableElements) {
      if (isKeyboardOrBoardElement(el)) continue;
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const testid = (el.getAttribute('data-testid') || '').toLowerCase();
      const cls = (el.getAttribute('class') || '').toLowerCase();
      const txt = (el.innerText || '').trim().toLowerCase();

      if (
        label.includes('close') || label.includes('dismiss') || label.includes('skip') ||
        testid.includes('close') || testid.includes('dismiss') ||
        cls.includes('close') || cls.includes('dismiss') ||
        txt === '✕' || txt === 'no thanks' || txt === 'maybe later' || txt === 'skip'
      ) {
        try {
          if (typeof el.click === 'function') {
            el.click();
            dismissed = true;
          } else if (el.parentElement && typeof el.parentElement.click === 'function') {
            el.parentElement.click();
            dismissed = true;
          }
          await sleep(250);
        } catch(e) {}
      }
    }
  }

  // 6. Click any active modal backdrop / overlay
  const overlays = document.querySelectorAll('[class*="Modal-module_overlay"], [class*="overlay"], [class*="backdrop"]');
  for (const overlay of overlays) {
    if (overlay && overlay.offsetWidth > 0 && overlay.offsetHeight > 0) {
      if (isKeyboardOrBoardElement(overlay)) continue;
      overlay.click();
      dismissed = true;
      await sleep(150);
    }
  }

  // 7. Only send Escape if we actually found and dismissed something
  if (dismissed) {
    dispatchKey("Escape");
    await sleep(200);
  }
}

// Lightweight modal check used per-turn — only handles nav drawer & account promos
// Does NOT send Escape keys (which would disrupt Wordle's input state)
async function quickDismissModals() {
  let dismissed = false;

  // Close any visible account promo, login promo, side nav drawer, or modal close button
  const quickSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label="Close navigation"]',
    '[data-testid="icon-close"]',
    '[data-testid="modal-close"]',
    '.Modal-module_closeIcon__25a2G',
    '[class*="closeIcon"]',
    '[class*="NavDrawer"] button[aria-label]',
  ];

  for (const sel of quickSelectors) {
    try {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        if (isKeyboardOrBoardElement(btn)) continue;
        if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
          btn.click();
          dismissed = true;
          await sleep(200);
        }
      }
    } catch(e) {}
  }
}

// Helper: Ensure we never click virtual keyboard or game board elements during modal sweeps
function isKeyboardOrBoardElement(el) {
  if (!el) return false;
  if (el.hasAttribute && (el.hasAttribute('data-key') || el.getAttribute('data-testid') === 'tile')) return true;
  if (el.closest && (el.closest('[data-testid="keyboard"]') || el.closest('[class*="Keyboard"]') || el.closest('[class*="Board"]') || el.closest('[data-testid="board"]'))) return true;
  return false;
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

// DOM Helper: Read tile states for row (returns null if any tile is still flipping)
function readFeedback(turnIndex) {
  const rows = document.querySelectorAll('div[class*="Row-module_row__"]');
  if (!rows[turnIndex]) return null;

  const tiles = rows[turnIndex].querySelectorAll('[data-testid="tile"]');
  if (tiles.length !== 5) return null;

  let feedback = "";
  for (let i = 0; i < 5; i++) {
    const state = tiles[i].getAttribute("data-state");
    if (!state || !["correct", "present", "absent"].includes(state)) {
      return null; // Tile animation in progress (e.g. "tENTATIVE" or "empty")
    }
    feedback += STATE_MAP[state];
  }
  return feedback;
}

// Poll until all 5 tiles in the row finish flipping and reveal state
async function waitForFeedback(turnIndex) {
  const maxWait = 4000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const fb = readFeedback(turnIndex);
    if (fb) return fb;
    await sleep(200);
  }
  return readFeedback(turnIndex);
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
  if (history.length >= 6) return true;
  return history.some(([_, p]) => p === "GGGGG");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
