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
      
      // Enforce Green, Yellow, and confirmed Absent (Black) history constraints
      let candidates = rawCandidates.filter(c => 
        !rejectedWords.has(c) && 
        history.every(([g, fb]) => getFeedback(g, c) === fb)
      );

      // Requirement 4: Targeted Datamuse query if yellow/green letters exist and candidates = 0
      const revealedLetters = new Set(
        history.flatMap(([g, fb]) => [...g].filter((ch, i) => fb[i] === 'G' || fb[i] === 'Y'))
      );

      if (candidates.length === 0 && revealedLetters.size > 0) {
        const yellowLetters = Array.from(revealedLetters);
        const hintPattern = `*${yellowLetters.slice(0, 3).join('*')}*`;
        console.log(`🔎 Searching Datamuse with targeted pattern: ${hintPattern}`);
        const hintWords = await fetchDatamuseWords(hintPattern);
        const hintCandidates = hintWords.filter(c => 
          !rejectedWords.has(c) && 
          history.every(([g, fb]) => getFeedback(g, c) === fb)
        );
        if (hintCandidates.length > 0) {
          candidates = hintCandidates;
          console.log(`✨ Found ${candidates.length} candidates via targeted query!`);
        }
      }

      // Anagram Permutation Solver: If 4+ letters are known and candidates = 0, generate exact 5-letter anagram permutations
      if (candidates.length === 0 && revealedLetters.size >= 4) {
        console.log(`🔎 4+ letters known — generating exact 5-letter anagram permutations...`);
        const anagrams = getAnagramCandidates(history, rejectedWords);
        if (anagrams.length > 0) {
          candidates = anagrams;
          console.log(`✨ Found ${candidates.length} candidate(s) via anagram permutation solver: ${candidates.join(', ')}`);
        }
      }

      let guess;

      if (turn === 0) {
        // Requirement 1: First guess from TOP_OPENERS list
        const availableOpeners = TOP_OPENERS.filter(w => !rejectedWords.has(w));
        guess = availableOpeners[Math.floor(Math.random() * availableOpeners.length)];
      } else if (turn === 1 && history[0][1] === "BBBBB") {
        // Requirement 1: If opener gave all black (BBBBB), pick opener from TOP_OPENERS sharing <= 1 letter with opener 1
        const firstWord = history[0][0];
        const firstLetters = new Set(firstWord);
        const lowOverlapOpeners = TOP_OPENERS.filter(w => {
          if (w === firstWord || rejectedWords.has(w)) return false;
          const overlap = [...w].filter(ch => firstLetters.has(ch)).length;
          return overlap <= 1;
        });
        if (lowOverlapOpeners.length > 0) {
          guess = lowOverlapOpeners[Math.floor(Math.random() * lowOverlapOpeners.length)];
          console.log(`🔀 Opener 1 gave all-black (${firstWord}) -> Picked low-overlap opener 2: ${guess}`);
        } else {
          guess = await bestGuess(candidates, history, rejectedWords);
        }
      } else if (candidates.length > 0) {
        // Requirement 2 & 4: Normal Mode — use Shannon Entropy to pick optimal word from candidates
        guess = await bestGuess(candidates, history, rejectedWords);
      } else {
        // Requirement 3: Dynamic Probe Mode when candidates = 0
        console.warn("No live candidates found — switching to dynamic probe mode...");
        guess = await getProbeGuess(history, rejectedWords);
        console.log(`🔍 Probe guess: ${guess}`);
      }

      if (!guess) {
        console.warn("No guess selected!");
        return;
      }

      console.log(`Bot guessing: ${guess} (${candidates.length} candidates left)`);
      await typeGuess(guess, turn);
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

// Helper: Fetch candidates dynamically from Datamuse API with timeout, caching & reranking (Requirement 5)
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
    let words = data
      .map(d => d.word.toUpperCase())
      .filter(w => /^[A-Z]{5}$/.test(w));

    // Rerank words by letter frequency naturalness score to filter out obscure terms (Requirement 5)
    words.sort((a, b) => getWordNaturalnessScore(b) - getWordNaturalnessScore(a));

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

// Helper: Natural English word score based on letter frequency distribution
function getWordNaturalnessScore(word) {
  const uniqueChars = [...new Set(word.split(''))];
  return uniqueChars.reduce((sum, ch) => sum + (LETTER_WEIGHTS[ch] || 1.0), 0) / 100;
}

async function bestGuess(candidates, history = [], rejectedWords = new Set()) {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 2) return candidates[0]; // 50/50 chance

  let bestWord = null;
  let bestScore = -1.0;

  // 1. Evaluate candidate pool (entropy + candidate bonus + natural letter frequency score)
  const pool = candidates.length <= 40 ? candidates : candidates.slice(0, 150);
  for (const word of pool) {
    const score = calculateEntropy(word, candidates) + 0.15 + getWordNaturalnessScore(word);
    if (score > bestScore) {
      bestWord = word;
      bestScore = score;
    }
  }

  // 2. If candidates >= 3 and <= 30, also evaluate non-candidate probe words
  if (candidates.length >= 3 && candidates.length <= 30) {
    const probeCandidates = await getProbeCandidates(history, rejectedWords);
    for (const probe of probeCandidates) {
      if (candidates.includes(probe)) continue;
      const score = calculateEntropy(probe, candidates);
      if (score > bestScore) {
        bestWord = probe;
        bestScore = score;
        console.log(`💡 High-entropy non-candidate probe chosen: ${probe}`);
      }
    }
  }

  return bestWord || candidates[0];
}

// Helper: Get letters confirmed absent (seen as B, never as G or Y)
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

// Helper: Dynamic Probe Mode when Datamuse candidates = 0 (Requirement 3)
// Tier 1: Form a valid 5-letter word using ONLY unattempted letters (0 assigned color letters).
// Tier 2: If Tier 1 is unaccepted or empty, retry with a word having AT MOST 2 assigned color letters.
// Tier 3: Retry fallback with any unguessed valid 5-letter word from Datamuse/TOP_OPENERS.
async function getProbeGuess(history, rejectedWords = new Set()) {
  const testedLetters = new Set();
  const assignedColorLetters = new Set();

  for (const [guess, fb] of history) {
    for (let i = 0; i < 5; i++) {
      testedLetters.add(guess[i]);
      assignedColorLetters.add(guess[i]);
    }
  }

  const untestedLetters = new Set(
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter(l => !testedLetters.has(l))
  );

  let probePool = await fetchDatamuseWords('?????');
  probePool = probePool.filter(w => /^[A-Z]{5}$/.test(w));

  // Tier 1: Words formed from ONLY unattempted letters (0 assigned color letters)
  let validProbes = probePool.filter(word =>
    !rejectedWords.has(word) &&
    !history.some(([g]) => g === word) &&
    ![...word].some(ch => assignedColorLetters.has(ch)) &&
    [...word].some(ch => untestedLetters.has(ch))
  );

  // Tier 2: Retry with a word that has AT MOST 2 letters assigned a color (B/Y/G)
  if (validProbes.length === 0) {
    validProbes = probePool.filter(word => {
      if (rejectedWords.has(word) || history.some(([g]) => g === word)) return false;
      const coloredCount = [...word].filter(ch => assignedColorLetters.has(ch)).length;
      const hasUntested = [...word].some(ch => untestedLetters.has(ch));
      return coloredCount <= 2 && hasUntested;
    });
  }

  // Tier 3: General fallback from probePool or TOP_OPENERS
  if (validProbes.length === 0) {
    const fallbackPool = [...probePool, ...TOP_OPENERS, "FUDGY", "VEXED", "WALKS", "BUNCH", "PLUCK", "GLYPH"];
    validProbes = fallbackPool.filter(word =>
      !rejectedWords.has(word) &&
      !history.some(([g]) => g === word)
    );
  }

  // Absolute safety net
  if (validProbes.length === 0) return "FUDGY";

  // Score probe by sum of LETTER_WEIGHTS of its unattempted letters
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

// Helper: Natural English word score based on letter frequency distribution
function getWordNaturalnessScore(word) {
  const uniqueChars = [...new Set(word.split(''))];
  return uniqueChars.reduce((sum, ch) => sum + (LETTER_WEIGHTS[ch] || 1.0), 0) / 100;
}

async function bestGuess(candidates, history = [], rejectedWords = new Set()) {
  if (candidates.length === 1) return candidates[0];
  if (candidates.length === 2) return candidates[0]; // 50/50 chance

  let bestWord = null;
  let bestScore = -1.0;

  // 1. Evaluate candidate pool (entropy + candidate bonus + natural letter frequency score)
  const pool = candidates.length <= 40 ? candidates : candidates.slice(0, 150);
  for (const word of pool) {
    const score = calculateEntropy(word, candidates) + 0.15 + getWordNaturalnessScore(word);
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

// Helper: When probe mode is active, pick a valid probe word to test unchecked letters
// Uses a 3-tier fallback to GUARANTEE a valid guess is always returned (never returns null)
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

  // Tier 1: Probe words with 0 absent letters that test untested letters
  let validProbes = probePool.filter(word =>
    !rejectedWords.has(word) &&
    !history.some(([g]) => g === word) &&
    ![...word].some(ch => absentLetters.has(ch)) &&
    [...word].some(ch => untestedLetters.has(ch))
  );

  // Tier 2: If Tier 1 is empty, relax absent letter restriction (allow absent letters to test remaining untested letters)
  if (validProbes.length === 0) {
    validProbes = probePool.filter(word =>
      !rejectedWords.has(word) &&
      !history.some(([g]) => g === word) &&
      [...word].some(ch => untestedLetters.has(ch))
    );
  }

  // Tier 3: If Tier 2 is empty, pick ANY unguessed 5-letter word from probePool or TOP_OPENERS
  if (validProbes.length === 0) {
    const fallbackPool = [...probePool, ...TOP_OPENERS, "FUDGY", "CHINK", "JUMBO", "VEXED", "WALKS", "BUNCH", "PLUCK", "GLYPH"];
    validProbes = fallbackPool.filter(word =>
      !rejectedWords.has(word) &&
      !history.some(([g]) => g === word)
    );
  }

  // Safety net
  if (validProbes.length === 0) return "FUDGY";

  // Score probe by sum of letter frequency weights of its unique untested letters
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

// Helper: Anagram Permutation Candidate Generator when 4+ letters are known
function getAnagramCandidates(history, rejectedWords = new Set()) {
  const knownLetters = new Set();
  for (const [guess, fb] of history) {
    for (let i = 0; i < 5; i++) {
      if (fb[i] === 'G' || fb[i] === 'Y') {
        knownLetters.add(guess[i]);
      }
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
      for (const p of permute(rem)) {
        result.push([cur, ...p]);
      }
    }
    return result;
  }

  let perms = [];
  if (lettersArr.length === 5) {
    perms = permute(lettersArr).map(p => p.join(''));
  } else {
    const absent = getAbsentLetters(history);
    const extraCandidates = ['E','T','A','O','I','N','S','H','R','D','L','C','U','M','W','F','G','Y','P','B','V','K'].filter(l => !absent.has(l) && !knownLetters.has(l));
    for (const extra of extraCandidates) {
      const set5 = [...lettersArr, extra];
      const p5 = permute(set5).map(p => p.join(''));
      perms.push(...p5);
    }
  }

  const uniquePerms = Array.from(new Set(perms));
  return uniquePerms.filter(c =>
    !rejectedWords.has(c) &&
    history.every(([g, fb]) => getFeedback(g, c) === fb)
  );
}

// Reliable Key Dispatcher: Clicks Wordle virtual key button first, falls back to KeyboardEvent on window & document
async function pressKey(char) {
  const upper = char.toUpperCase();
  const lower = char.toLowerCase();

  const virtKey = document.querySelector(`button[data-key="${lower}"], button[data-key="${upper}"], [data-key="${lower}"], [data-key="${upper}"]`);
  if (virtKey && virtKey.offsetWidth > 0) {
    virtKey.click();
    await sleep(60);
    return;
  }

  const event = new KeyboardEvent("keydown", {
    key: char,
    code: char === "Enter" ? "Enter" : char === "Backspace" ? "Backspace" : `Key${upper}`,
    bubbles: true,
    cancelable: true
  });
  window.dispatchEvent(event);
  document.dispatchEvent(event);
  await sleep(60);
}

// DOM Helper: Bulletproof Type guess with 5-tile board length verification
async function typeGuess(word, turnIndex = 0) {
  await clearRow();
  await sleep(100);

  for (const char of word) {
    await pressKey(char);
    await sleep(90);
  }

  // Board length check: Ensure row has 5 letters typed before hitting Enter
  const rows = getRowElements();
  if (rows && rows[turnIndex]) {
    const tiles = rows[turnIndex].querySelectorAll('[data-testid="tile"]');
    const typedText = Array.from(tiles).map(t => (t.innerText || '').trim()).join('');
    
    if (typedText.length !== 5) {
      console.warn(`Row letter mismatch: expected 5 letters for '${word}', but board has '${typedText}'. Retrying...`);
      await clearRow();
      await sleep(150);
      for (const char of word) {
        await pressKey(char);
        await sleep(120);
      }
    }
  }

  await pressKey("Enter");
  await sleep(1200); // Allow tile flip animation to finish completely before reading feedback
}

async function clearRow() {
  for (let i = 0; i < 5; i++) {
    await pressKey("Backspace");
    await sleep(70);
  }
}

function getRowElements() {
  const selectors = ['div[class*="Row-module_row__"]', '[data-testid="row"]', 'div[class*="Row"]', 'div[class*="row"]'];
  for (const sel of selectors) {
    const rows = document.querySelectorAll(sel);
    if (rows && rows.length >= 6) return rows;
  }
  return document.querySelectorAll('div[class*="Row-module_row__"]');
}

// DOM Helper: Read tile states for row (returns null if any tile is still flipping)
function readFeedback(turnIndex) {
  const rows = getRowElements();
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
  // Fallback if animation timed out: force-read whatever states exist
  const rows = getRowElements();
  if (rows[turnIndex]) {
    const tiles = rows[turnIndex].querySelectorAll('[data-testid="tile"]');
    if (tiles.length === 5) {
      let fallbackFb = "";
      for (let i = 0; i < 5; i++) {
        const state = tiles[i].getAttribute("data-state");
        fallbackFb += STATE_MAP[state] || "B";
      }
      return fallbackFb;
    }
  }
  return null;
}

function isRowRejected(turnIndex) {
  const rows = getRowElements();
  if (!rows[turnIndex]) return true;

  const tiles = rows[turnIndex].querySelectorAll('[data-testid="tile"]');
  if (tiles.length !== 5) return true;

  const states = Array.from(tiles).map(t => t.getAttribute("data-state"));
  return !states.some(s => ["correct", "present", "absent"].includes(s));
}

function getExistingHistory() {
  const history = [];
  const rows = getRowElements();
  
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
