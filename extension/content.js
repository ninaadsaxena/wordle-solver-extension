/**
 * Wordle AI Auto-Solver Content Script
 * Powered by Datamuse API & Shannon Entropy Engine
 */

const STATE_MAP = {
  correct: "G",
  present: "Y",
  absent: "B"
};

// Top openers ranked by Shannon Entropy (bits of expected information gain).
// Source: Information-theory Wordle research (3Blue1Brown, MIT benchmarks).
const TOP_OPENERS = [
  "SALET", "TRACE", "CRANE", "CRATE", "SLATE",
  "STARE", "RAISE", "SNARE", "AROSE", "LEAST"
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
    await dismissModals();
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
      // No candidates match all constraints — fall back to a probe guess
      // that tests as many untested letters as possible without using
      // confirmed-absent letters. This mirrors what a skilled human does
      // (e.g. guessing POLER / REPEL to check new letters).
      console.warn("No live candidates — switching to probe mode...");
      guess = await getProbeGuess(history, rejectedWords);
      if (!guess) {
        console.warn("Probe mode exhausted — cannot continue.");
        isSolving = false;
        return;
      }
      console.log(`🔍 Probe guess: ${guess} (testing unchecked letters)`);
    } else if (turn === 0) {
      const validOpeners = TOP_OPENERS.filter(w => candidates.includes(w));
      guess = validOpeners.length > 0
        ? validOpeners[Math.floor(Math.random() * validOpeners.length)]
        : bestGuess(candidates);
    } else if (turn === 1 && shouldPlayFreeGuess(history)) {
      // Turn 2 free-probe strategy: if the opener gave ≤ 2 green/yellow
      // positions, it's more valuable to test a completely fresh set of
      // letters than to prematurely narrow candidates.
      // This mirrors the human strategy seen in: CLOUD → VIXEN → GRAPE …
      // where the second guess deliberately ignores known yellow letters
      // to cover more of the alphabet.
      const freeGuess = await getProbeGuess(history, rejectedWords);
      if (freeGuess) {
        guess = freeGuess;
        console.log(`🔀 Free second guess: ${guess} (opener gave only ${getUsefulLetterCount(history[0])} useful positions — probing fresh letters)`);
      } else {
        guess = bestGuess(candidates); // fallback to candidates if probe fails
      }
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

// Helper: When no candidates satisfy constraints, pick a valid word that
// tests the maximum number of unchecked letters ("probe" / elimination guess).
async function getProbeGuess(history, rejectedWords = new Set()) {
  const testedLetters = new Set();
  const absentLetters = getAbsentLetters(history);

  for (const [guess] of history) {
    for (const ch of guess) testedLetters.add(ch);
  }

  // Letters we haven't tried at all yet
  const untestedLetters = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !testedLetters.has(l))
  );

  // Fetch a broad pool of 5-letter words from Datamuse
  const probePool = await fetchDatamuseWords('?????');

  // Exclude: already-rejected words + words that use confirmed-absent letters
  const validProbes = probePool.filter(word =>
    !rejectedWords.has(word) &&
    ![...word].some(ch => absentLetters.has(ch))
  );

  if (validProbes.length === 0) return null;

  // Score each candidate by unique untested letters it covers
  let bestProbe = null;
  let bestScore = -1;
  for (const word of validProbes) {
    const score = [...new Set(word.split(''))].filter(ch => untestedLetters.has(ch)).length;
    if (score > bestScore) {
      bestScore = score;
      bestProbe = word;
    }
  }

  return bestProbe;
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
        if (closeBtn && closeBtn.offsetWidth > 0 && closeBtn.offsetHeight > 0) {
          closeBtn.click();
          await sleep(250);
        }
      }
    } catch(e) {}
  }

  // 5. Generic Dialog & Modal Sweep: scan any open dialog/modal container for close/skip/dismiss buttons
  const dialogContainers = document.querySelectorAll('[role="dialog"], [class*="Modal"], [class*="modal"], [class*="Dialog"], [class*="dialog"], [class*="Overlay"], [class*="overlay"], [class*="popup"], [class*="Popup"]');
  for (const container of dialogContainers) {
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) continue;

    const clickableElements = Array.from(container.querySelectorAll('button, svg, a, div[role="button"], span[role="button"]'));
    for (const el of clickableElements) {
      const label = (el.getAttribute('aria-label') || '').toLowerCase();
      const testid = (el.getAttribute('data-testid') || '').toLowerCase();
      const cls = (el.getAttribute('class') || '').toLowerCase();
      const txt = (el.innerText || '').trim().toLowerCase();

      if (
        label.includes('close') || label.includes('dismiss') || label.includes('skip') ||
        testid.includes('close') || testid.includes('dismiss') ||
        cls.includes('close') || cls.includes('dismiss') ||
        txt === 'x' || txt === '✕' || txt === 'no thanks' || txt === 'maybe later' || txt === 'skip'
      ) {
        try {
          if (typeof el.click === 'function') {
            el.click();
          } else if (el.parentElement && typeof el.parentElement.click === 'function') {
            el.parentElement.click();
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
      overlay.click();
      await sleep(150);
    }
  }

  // 7. Send Escape key twice to dismiss any lingering popups or drawers
  dispatchKey("Escape");
  await sleep(150);
  dispatchKey("Escape");
  await sleep(250);
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
  if (history.length >= 6) return true;
  return history.some(([_, p]) => p === "GGGGG");
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
