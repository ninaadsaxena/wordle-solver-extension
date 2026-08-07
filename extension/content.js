/**
 * Wordle AI Auto-Solver Content Script
 * Powered by Datamuse API & Shannon Entropy Engine
 * v1.5.0 - Robust DOM detection, no hardcoded dictionaries
 */

const STATE_MAP = {
  correct: "G",
  present: "Y",
  absent: "B"
};

// Top openers combining high Shannon Entropy + popular NYT Wordle Bot picks
const TOP_OPENERS = [
  "SALET", "TRACE", "CRANE", "CRATE", "SLATE",
  "STARE", "RAISE", "SNARE", "AROSE", "LEAST",
  "ADIEU", "AUDIO", "ARISE", "HOUSE", "TRAIN",
  "IRATE", "GREAT", "HEART", "DREAM", "OCEAN"
];

// English Letter Frequency weights
const LETTER_WEIGHTS = {
  E: 12.7, T: 9.1, A: 8.2, O: 7.5, I: 7.0, N: 6.7, S: 6.3, H: 6.1, R: 6.0,
  D: 4.3, L: 4.0, C: 2.8, U: 2.8, M: 2.4, W: 2.4, F: 2.2, G: 2.0, Y: 2.0,
  P: 1.9, B: 1.5, V: 1.0, K: 0.8, J: 0.15, X: 0.15, Q: 0.1, Z: 0.07
};

let isSolving = false;

// Prevent duplicate injection: if already injected, skip re-setup
if (window.__wordleSolverInjected) {
  console.log("Content script already injected - skipping re-setup.");
} else {
  window.__wordleSolverInjected = true;

  // Listen for messages from extension popup
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'START_SOLVER') {
      if (isSolving) {
        console.log("Solver already running.");
        sendResponse({ status: 'already_running' });
      } else {
        runSolver();
        sendResponse({ status: 'started' });
      }
    }
    return true; // Keep message channel open
  });

  // Auto-dismiss modals on page load
  if (document.readyState === 'complete') {
    setTimeout(dismissModals, 1000);
  } else {
    window.addEventListener('load', () => setTimeout(dismissModals, 1000));
  }
}

// =============================================================================
// Main Solver
// =============================================================================

async function runSolver() {
  if (isSolving) return;
  isSolving = true;
  console.log("Wordle AI Auto-Solver v1.5.0 started...");

  try {
    // Detect game board structure before doing anything
    const gameRoot = await detectGameRoot();
    if (!gameRoot) {
      console.error("Could not detect Wordle game board. Is the page fully loaded?");
      isSolving = false;
      return;
    }
    console.log("Game board detected. Type:", gameRoot.type);

    await dismissModals();
    await sleep(800);

    if (isAlreadyCompleted(gameRoot)) {
      console.log("Today's Wordle has already been completed!");
      isSolving = false;
      return;
    }

    // Pre-fetch probe word pool in background
    fetchDatamuseWords('?????');

    const existingHistory = getExistingHistory(gameRoot);
    console.log("Resuming from turn " + existingHistory.length + ". History:", existingHistory);
    const history = [...existingHistory];
    const rejectedWords = new Set();

    let turn = history.length;

    while (turn < 6) {
      console.log("\n--- Turn " + (turn + 1) + " ---");
      await quickDismissModals();

      const patternStr = buildPattern(history);
      console.log("Datamuse pattern: \"" + patternStr + "\"");

      const rawCandidates = await fetchDatamuseWords(patternStr);
      let candidates = rawCandidates.filter(c =>
        !rejectedWords.has(c) &&
        history.every(([g, fb]) => getFeedback(g, c) === fb)
      );
      console.log("Candidates after filtering: " + candidates.length);

      // Targeted query if we have yellow/green letters but no candidates
      const revealedLetters = new Set(
        history.flatMap(([g, fb]) => [...g].filter((ch, i) => fb[i] === 'G' || fb[i] === 'Y'))
      );

      if (candidates.length === 0 && revealedLetters.size > 0) {
        const yellowLetters = Array.from(revealedLetters);
        const hintPattern = `*${yellowLetters.slice(0, 3).join('*')}*`;
        console.log("Targeted Datamuse query: " + hintPattern);
        const hintWords = await fetchDatamuseWords(hintPattern);
        const hintCandidates = hintWords.filter(c =>
          !rejectedWords.has(c) &&
          history.every(([g, fb]) => getFeedback(g, c) === fb)
        );
        if (hintCandidates.length > 0) {
          candidates = hintCandidates;
          console.log("Found " + candidates.length + " candidates via targeted query!");
        }
      }

      // Anagram solver: 4+ letters known
      if (candidates.length === 0 && revealedLetters.size >= 4) {
        console.log("4+ letters known - generating anagram permutations...");
        const anagrams = getAnagramCandidates(history, rejectedWords);
        if (anagrams.length > 0) {
          candidates = anagrams;
          console.log("Anagram candidates: " + candidates.join(', '));
        }
      }

      let guess;

      if (turn === 0) {
        // Rule 1: First guess from TOP_OPENERS
        const availableOpeners = TOP_OPENERS.filter(w => !rejectedWords.has(w));
        guess = availableOpeners[Math.floor(Math.random() * availableOpeners.length)];
        console.log("Opening with: " + guess);
      } else if (turn === 1 && history[0][1] === "BBBBB") {
        // Rule 1: All-black opener - pick low-overlap second opener
        const firstWord = history[0][0];
        const firstLetters = new Set(firstWord);
        const lowOverlapOpeners = TOP_OPENERS.filter(w => {
          if (w === firstWord || rejectedWords.has(w)) return false;
          return [...w].filter(ch => firstLetters.has(ch)).length <= 1;
        });
        if (lowOverlapOpeners.length > 0) {
          guess = lowOverlapOpeners[Math.floor(Math.random() * lowOverlapOpeners.length)];
          console.log("All-black opener: picked low-overlap second: " + guess);
        } else {
          guess = await bestGuess(candidates, history, rejectedWords);
        }
      } else if (candidates.length > 0) {
        // Rule 2: Shannon Entropy to pick best candidate
        guess = await bestGuess(candidates, history, rejectedWords);
      } else {
        // Rule 3: Dynamic probe mode
        console.warn("No candidates - switching to probe mode...");
        guess = await getProbeGuess(history, rejectedWords);
        console.log("Probe guess: " + guess);
      }

      if (!guess) {
        console.warn("No guess selected! Aborting.");
        break;
      }

      console.log("Guessing: " + guess + " (" + candidates.length + " candidates)");
      const typed = await typeGuess(guess, turn, gameRoot);

      if (!typed) {
        console.warn("Failed to type guess '" + guess + "'. Marking as rejected.");
        rejectedWords.add(guess);
        continue;
      }

      await sleep(600);

      // Check if Wordle rejected the word
      if (isRowRejected(turn, gameRoot)) {
        console.warn("Word '" + guess + "' not accepted! Clearing and retrying...");
        await clearRow(gameRoot);
        rejectedWords.add(guess);
        continue;
      }

      const fb = await waitForFeedback(turn, gameRoot);
      console.log("Feedback for '" + guess + "': " + fb);

      if (!fb) {
        console.error("Failed to read feedback! Aborting turn.");
        break;
      }

      if (fb === "GGGGG") {
        console.log("Solved in " + (turn + 1) + " guess" + (turn === 0 ? "" : "es") + "!");
        return;
      }

      history.push([guess, fb]);
      turn++;
    }

    console.log("Game finished (6 guesses used).");
  } catch (err) {
    console.error("Solver error:", err);
  } finally {
    isSolving = false;
  }
}

// =============================================================================
// DOM Detection - Multi-Strategy Board & Keyboard Finder
// =============================================================================

async function detectGameRoot() {
  // Retry up to 10s in case page is still loading
  for (let attempt = 0; attempt < 20; attempt++) {
    const root = tryDetectBoard();
    if (root) return root;
    await sleep(500);
  }
  return null;
}

function tryDetectBoard() {
  // Strategy 1: Standard light DOM (data-testid="board")
  let board = document.querySelector('[data-testid="board"]');
  let keyboard = document.querySelector('[data-testid="keyboard"]');
  if (board) {
    return { type: 'standard', board, keyboard, root: document };
  }

  // Strategy 2: NYT custom element shadow root (wordle-app or game-app)
  const customEl = document.querySelector('wordle-app') || document.querySelector('game-app');
  if (customEl && customEl.shadowRoot) {
    board = customEl.shadowRoot.querySelector('[data-testid="board"]') ||
            customEl.shadowRoot.querySelector('game-board') ||
            customEl.shadowRoot.querySelector('[id="board"]');
    keyboard = customEl.shadowRoot.querySelector('[data-testid="keyboard"]') ||
               customEl.shadowRoot.querySelector('game-keyboard');
    if (board) {
      return { type: 'shadow', board, keyboard, root: customEl.shadowRoot };
    }
  }

  // Strategy 3: Class name based (React module class names)
  const boardByClass = document.querySelector('[class*="Board-module_board"]') ||
                       document.querySelector('[class*="board"]');
  const kbByClass = document.querySelector('[class*="Keyboard-module_keyboard"]') ||
                    document.querySelector('[class*="keyboard"]');
  if (boardByClass) {
    return { type: 'classname', board: boardByClass, keyboard: kbByClass, root: document };
  }

  // Strategy 4: Deep shadow scan
  const allEls = document.querySelectorAll('*');
  for (const el of allEls) {
    if (el.shadowRoot) {
      const b = el.shadowRoot.querySelector('[data-testid="board"]') ||
                el.shadowRoot.querySelector('game-board');
      if (b) {
        const k = el.shadowRoot.querySelector('[data-testid="keyboard"]') ||
                  el.shadowRoot.querySelector('game-keyboard');
        return { type: 'deep-shadow', board: b, keyboard: k, root: el.shadowRoot };
      }
    }
  }

  return null;
}

// =============================================================================
// Row / Tile Helpers
// =============================================================================

function getRowElements(gameRoot) {
  const root = (gameRoot && gameRoot.root) ? gameRoot.root : document;
  const board = (gameRoot && gameRoot.board) ? gameRoot.board : null;

  const selectors = [
    '[data-testid="row"]',
    '[class*="Row-module_row"]',
    'game-row',
    '[class*="Row"]',
  ];

  for (const sel of selectors) {
    const container = board || root;
    const rows = container.querySelectorAll(sel);
    if (rows && rows.length >= 6) return rows;
  }

  // Fallback: search entire document
  for (const sel of selectors) {
    const rows = document.querySelectorAll(sel);
    if (rows && rows.length >= 6) return rows;
  }

  return [];
}

function getTilesFromRow(rowEl) {
  // Standard tiles (data-testid="tile")
  let tiles = rowEl.querySelectorAll('[data-testid="tile"]');
  if (tiles && tiles.length === 5) return tiles;

  // Shadow DOM: game-tile inside game-row shadow root
  if (rowEl.shadowRoot) {
    const shadowTiles = rowEl.shadowRoot.querySelectorAll('game-tile, [data-testid="tile"], [class*="tile"]');
    if (shadowTiles && shadowTiles.length === 5) return shadowTiles;
  }

  // Class-based tiles
  tiles = rowEl.querySelectorAll('[class*="Tile-module_tile"], [class*="tile"]');
  if (tiles && tiles.length === 5) return tiles;

  return [];
}

function getTileState(tileEl) {
  // Standard: data-state attribute
  let state = tileEl.getAttribute('data-state');
  if (state) return state;

  // Shadow DOM: check inside shadow root of game-tile
  if (tileEl.shadowRoot) {
    const inner = tileEl.shadowRoot.querySelector('[class*="tile"]');
    if (inner) {
      state = inner.getAttribute('data-state') || inner.getAttribute('letter-value');
      if (state) return state;
    }
  }

  // Evaluation attribute (older Wordle)
  state = tileEl.getAttribute('evaluation') || tileEl.getAttribute('letter');
  return state;
}

function getTileText(tileEl) {
  let txt = (tileEl.innerText || tileEl.textContent || '').trim().toUpperCase();
  if (txt) return txt;

  // Shadow DOM
  if (tileEl.shadowRoot) {
    const inner = tileEl.shadowRoot.querySelector('div, span');
    if (inner) txt = (inner.innerText || inner.textContent || '').trim().toUpperCase();
  }

  // Attribute fallback
  txt = tileEl.getAttribute('data-letter') || tileEl.getAttribute('letter') || '';
  return txt.toUpperCase();
}

// =============================================================================
// Keyboard Input - Multi-Strategy
// =============================================================================

async function pressKey(char, gameRoot) {
  const upper = char.toUpperCase();
  const lower = char.toLowerCase();
  const isSpecial = char === 'Enter' || char === 'Backspace';

  // Strategy 1: Find and click the virtual keyboard button
  const searchRoots = [document];
  if (gameRoot && gameRoot.root && gameRoot.root !== document) {
    searchRoots.push(gameRoot.root);
  }

  for (const root of searchRoots) {
    let btn = root.querySelector(`button[data-key="${lower}"]`) ||
              root.querySelector(`button[data-key="${upper}"]`) ||
              root.querySelector(`[data-key="${lower}"]`) ||
              root.querySelector(`[data-key="${upper}"]`);

    if (!btn && char === 'Enter') {
      btn = root.querySelector('button[aria-label="enter"]') ||
            root.querySelector('button[data-testid="keyboard-enter"]') ||
            Array.from(root.querySelectorAll('button')).find(b =>
              (b.innerText || b.textContent || '').trim().toLowerCase() === 'enter'
            );
    }

    if (!btn && char === 'Backspace') {
      btn = root.querySelector('button[aria-label="backspace"]') ||
            root.querySelector('button[data-testid="keyboard-delete"]') ||
            Array.from(root.querySelectorAll('button')).find(b =>
              ['backspace', '⌫', '<'].includes((b.innerText || b.getAttribute('data-key') || '').trim().toLowerCase())
            );
    }

    if (btn && btn.offsetWidth > 0) {
      btn.click();
      await sleep(50);
      return true;
    }
  }

  // Strategy 2: Dispatch KeyboardEvent to all possible listeners
  const eventProps = {
    key: char,
    code: isSpecial ? char : `Key${upper}`,
    keyCode: isSpecial ? (char === 'Enter' ? 13 : 8) : upper.charCodeAt(0),
    which: isSpecial ? (char === 'Enter' ? 13 : 8) : upper.charCodeAt(0),
    bubbles: true,
    cancelable: true,
    composed: true,
  };

  const keydown = new KeyboardEvent('keydown', eventProps);
  const keyup = new KeyboardEvent('keyup', eventProps);

  // Dispatch to all likely listener targets
  document.body.dispatchEvent(keydown);
  document.dispatchEvent(keydown);
  window.dispatchEvent(keydown);

  if (!isSpecial) {
    const keypress = new KeyboardEvent('keypress', eventProps);
    document.body.dispatchEvent(keypress);
    document.dispatchEvent(keypress);
  }

  document.body.dispatchEvent(keyup);
  document.dispatchEvent(keyup);

  await sleep(50);
  return true;
}

async function typeGuess(word, turnIndex, gameRoot) {
  // Clear any partial input first
  await clearRow(gameRoot);
  await sleep(150);

  for (const char of word) {
    await pressKey(char, gameRoot);
    await sleep(100);
  }

  // Verify 5 letters are typed before hitting Enter
  const rows = getRowElements(gameRoot);
  const targetRow = rows[turnIndex];

  if (targetRow) {
    const tiles = getTilesFromRow(targetRow);
    if (tiles && tiles.length > 0) {
      const typedText = Array.from(tiles).map(t => getTileText(t)).join('');
      console.log("Row " + turnIndex + " typed: '" + typedText + "'");

      if (typedText.length !== 5) {
        console.warn("Typed '" + typedText + "' but expected '" + word + "'. Retrying...");
        await clearRow(gameRoot);
        await sleep(200);
        for (const char of word) {
          await pressKey(char, gameRoot);
          await sleep(130);
        }
      }
    }
  }

  await pressKey("Enter", gameRoot);
  await sleep(1400); // Wait for flip animation
  return true;
}

async function clearRow(gameRoot) {
  for (let i = 0; i < 6; i++) {
    await pressKey("Backspace", gameRoot);
    await sleep(60);
  }
}

// =============================================================================
// Feedback Readers
// =============================================================================

function readFeedback(turnIndex, gameRoot) {
  const rows = getRowElements(gameRoot);
  if (!rows || !rows[turnIndex]) return null;

  const tiles = getTilesFromRow(rows[turnIndex]);
  if (!tiles || tiles.length !== 5) return null;

  let feedback = "";
  for (let i = 0; i < 5; i++) {
    const state = getTileState(tiles[i]);
    if (!state || !['correct', 'present', 'absent'].includes(state)) {
      return null; // Still animating
    }
    feedback += STATE_MAP[state];
  }
  return feedback;
}

async function waitForFeedback(turnIndex, gameRoot) {
  const maxWait = 6000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    const fb = readFeedback(turnIndex, gameRoot);
    if (fb) return fb;
    await sleep(200);
  }

  // Fallback: force-read whatever states exist
  const rows = getRowElements(gameRoot);
  if (rows && rows[turnIndex]) {
    const tiles = getTilesFromRow(rows[turnIndex]);
    if (tiles && tiles.length === 5) {
      let fallbackFb = "";
      for (let i = 0; i < 5; i++) {
        const state = getTileState(tiles[i]);
        fallbackFb += STATE_MAP[state] || "B";
      }
      console.warn("Fallback feedback read: " + fallbackFb);
      return fallbackFb;
    }
  }
  return null;
}

function isRowRejected(turnIndex, gameRoot) {
  const rows = getRowElements(gameRoot);
  if (!rows || !rows[turnIndex]) return true;

  const tiles = getTilesFromRow(rows[turnIndex]);
  if (!tiles || tiles.length !== 5) return true;

  const states = Array.from(tiles).map(t => getTileState(t));
  return !states.some(s => ['correct', 'present', 'absent'].includes(s));
}

function getExistingHistory(gameRoot) {
  const history = [];
  const rows = getRowElements(gameRoot);
  if (!rows || rows.length === 0) return history;

  for (let i = 0; i < rows.length; i++) {
    const tiles = getTilesFromRow(rows[i]);
    if (!tiles || tiles.length !== 5) break;

    let word = "";
    let pattern = "";
    let isValidRow = true;

    for (let t = 0; t < 5; t++) {
      const char = getTileText(tiles[t]);
      const state = getTileState(tiles[t]);

      if (!char || !STATE_MAP[state]) {
        isValidRow = false;
        break;
      }

      word += char;
      pattern += STATE_MAP[state];
    }

    if (isValidRow && word.length === 5) {
      history.push([word, pattern]);
    } else {
      break;
    }
  }

  return history;
}

function isAlreadyCompleted(gameRoot) {
  const stats = document.querySelector('h2');
  if (stats && stats.innerText && stats.innerText.includes("STATISTICS")) return true;

  const history = getExistingHistory(gameRoot);
  if (history.length >= 6) return true;
  return history.some(([_, p]) => p === "GGGGG");
}

// =============================================================================
// Modal Dismissal
// =============================================================================

function isKeyboardOrBoardElement(el) {
  if (!el) return false;
  if (el.hasAttribute && (el.hasAttribute('data-key') || el.getAttribute('data-testid') === 'tile')) return true;
  if (el.closest && (
    el.closest('[data-testid="keyboard"]') ||
    el.closest('[class*="Keyboard"]') ||
    el.closest('[class*="Board"]') ||
    el.closest('[data-testid="board"]')
  )) return true;
  return false;
}

async function dismissModals() {
  let dismissed = false;

  const acceptSelectors = [
    "#onetrust-accept-btn-handler",
    "#accept-all",
    "button[id*='accept']",
    "button[class*='accept']"
  ];

  for (const selector of acceptSelectors) {
    const btn = document.querySelector(selector);
    if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
      btn.click();
      dismissed = true;
      await sleep(400);
      break;
    }
  }

  const allBtns = Array.from(document.querySelectorAll("button"));
  const privacyBtn = allBtns.find(b => {
    const txt = (b.innerText || '').trim().toLowerCase();
    return (txt === "accept all" || txt === "accept" || txt === "reject all") &&
           b.offsetWidth > 0 && b.offsetHeight > 0;
  });
  if (privacyBtn) {
    privacyBtn.click();
    await sleep(400);
    dismissed = true;
  }

  const playBtn = document.querySelector('[data-testid="Play"]') ||
    Array.from(document.querySelectorAll("button")).find(b =>
      (b.innerText || '').trim().toLowerCase() === "play" && b.offsetWidth > 0
    );
  if (playBtn && playBtn.offsetWidth > 0) {
    playBtn.click();
    await sleep(500);
    dismissed = true;
  }

  const closeSelectors = [
    'button[aria-label="Close"]',
    'button[aria-label="close"]',
    '[data-testid="icon-close"]',
    '[data-testid="modal-close"]',
    '[class*="closeIcon"]',
    '[class*="CloseIcon"]',
    '[class*="closeButton"]',
    '[class*="CloseButton"]',
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
    } catch (e) {}
  }

  if (dismissed) await sleep(300);
}

async function quickDismissModals() {
  const quickSelectors = [
    'button[aria-label="Close"]',
    '[data-testid="icon-close"]',
    '[data-testid="modal-close"]',
    '[class*="closeIcon"]',
  ];

  for (const sel of quickSelectors) {
    try {
      const btns = document.querySelectorAll(sel);
      for (const btn of btns) {
        if (isKeyboardOrBoardElement(btn)) continue;
        if (btn && btn.offsetWidth > 0 && btn.offsetHeight > 0) {
          btn.click();
          await sleep(200);
        }
      }
    } catch (e) {}
  }
}

// =============================================================================
// Solver Logic (Datamuse + Shannon Entropy)
// =============================================================================

let cachedProbePool = null;

async function fetchDatamuseWords(pattern) {
  if (pattern === '?????' && cachedProbePool && cachedProbePool.length > 0) {
    return cachedProbePool;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(pattern)}&max=1000`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    let words = data
      .map(d => d.word.toUpperCase())
      .filter(w => /^[A-Z]{5}$/.test(w));

    words.sort((a, b) => getWordNaturalnessScore(b) - getWordNaturalnessScore(a));

    if (pattern === '?????' && words.length > 0) {
      cachedProbePool = words;
    }
    return words;
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("Datamuse fetch failed/timed out:", err.message);
    return cachedProbePool || TOP_OPENERS;
  }
}

function buildPattern(history) {
  const pattern = ["?", "?", "?", "?", "?"];
  for (const [guess, fb] of history) {
    for (let i = 0; i < 5; i++) {
      if (fb[i] === "G") pattern[i] = guess[i];
    }
  }
  return pattern.join("");
}

function getFeedback(guess, answer) {
  const result = ["B", "B", "B", "B", "B"];
  const remaining = answer.split("");

  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) {
      result[i] = "G";
      remaining[i] = null;
    }
  }

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

function getWordNaturalnessScore(word) {
  const uniqueChars = [...new Set(word.split(''))];
  return uniqueChars.reduce((sum, ch) => sum + (LETTER_WEIGHTS[ch] || 1.0), 0) / 100;
}

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
  return new Set([...blackSeen].filter(l => !present.has(l)));
}

async function bestGuess(candidates, history = [], rejectedWords = new Set()) {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 2) return candidates[0];

  let bestWord = null;
  let bestScore = -1.0;

  const pool = candidates.length <= 40 ? candidates : candidates.slice(0, 150);
  for (const word of pool) {
    const score = calculateEntropy(word, candidates) + 0.15 + getWordNaturalnessScore(word);
    if (score > bestScore) {
      bestWord = word;
      bestScore = score;
    }
  }

  if (candidates.length >= 3 && candidates.length <= 30) {
    const probeCandidates = await getProbeCandidates(history, rejectedWords);
    for (const probe of probeCandidates) {
      if (candidates.includes(probe)) continue;
      const score = calculateEntropy(probe, candidates);
      if (score > bestScore) {
        bestWord = probe;
        bestScore = score;
        console.log("High-entropy probe chosen: " + probe);
      }
    }
  }

  return bestWord || candidates[0];
}

async function getProbeCandidates(history, rejectedWords = new Set()) {
  const absentLetters = getAbsentLetters(history);
  const probePool = await fetchDatamuseWords('?????');
  const combined = Array.from(new Set([...probePool, ...TOP_OPENERS]));

  return combined.filter(word =>
    !rejectedWords.has(word) &&
    ![...word].some(ch => absentLetters.has(ch))
  ).slice(0, 60);
}

async function getProbeGuess(history, rejectedWords = new Set()) {
  const testedLetters = new Set();
  const absentLetters = getAbsentLetters(history);

  for (const [guess] of history) {
    for (const ch of guess) testedLetters.add(ch);
  }

  const untestedLetters = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !testedLetters.has(l))
  );

  let probePool = await fetchDatamuseWords('?????');

  let validProbes = probePool.filter(word =>
    !rejectedWords.has(word) &&
    !history.some(([g]) => g === word) &&
    ![...word].some(ch => absentLetters.has(ch)) &&
    [...word].some(ch => untestedLetters.has(ch))
  );

  if (validProbes.length === 0) {
    validProbes = probePool.filter(word =>
      !rejectedWords.has(word) &&
      !history.some(([g]) => g === word) &&
      [...word].some(ch => untestedLetters.has(ch))
    );
  }

  if (validProbes.length === 0) {
    const fallback = [...probePool, ...TOP_OPENERS, "FUDGY", "CHINK", "JUMBO", "VEXED", "WALKS", "BUNCH", "PLUCK", "GLYPH"];
    validProbes = fallback.filter(word =>
      !rejectedWords.has(word) && !history.some(([g]) => g === word)
    );
  }

  if (validProbes.length === 0) return "FUDGY";

  let bestProbe = validProbes[0];
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

function getAnagramCandidates(history, rejectedWords = new Set()) {
  const knownLetters = new Set();
  for (const [guess, fb] of history) {
    for (let i = 0; i < 5; i++) {
      if (fb[i] === 'G' || fb[i] === 'Y') knownLetters.add(guess[i]);
    }
  }

  if (knownLetters.size < 4) return [];
  const lettersArr = Array.from(knownLetters);

  function permute(arr) {
    if (arr.length <= 1) return [arr];
    const result = [];
    for (let i = 0; i < arr.length; i++) {
      const cur = arr[i];
      const rem = arr.slice(0, i).concat(arr.slice(i + 1));
      for (const p of permute(rem)) result.push([cur, ...p]);
    }
    return result;
  }

  let perms = [];
  if (lettersArr.length === 5) {
    perms = permute(lettersArr).map(p => p.join(''));
  } else {
    const absent = getAbsentLetters(history);
    const extraCandidates = ['E','T','A','O','I','N','S','H','R','D','L','C','U','M','W','F','G','Y','P','B','V','K']
      .filter(l => !absent.has(l) && !knownLetters.has(l));
    for (const extra of extraCandidates) {
      const p5 = permute([...lettersArr, extra]).map(p => p.join(''));
      perms.push(...p5);
    }
  }

  const uniquePerms = Array.from(new Set(perms));
  return uniquePerms.filter(c =>
    !rejectedWords.has(c) &&
    history.every(([g, fb]) => getFeedback(g, c) === fb)
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
