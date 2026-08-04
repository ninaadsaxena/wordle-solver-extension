# 🟩🟨⬛ Wordle Auto-Solver — Browser Extension & Landing Page

An Information-Entropy & Datamuse AI Wordle Auto-Solver packaged as a zero-dependency **Manifest V3 Chrome Extension**, with a Vercel-ready landing page for distribution.

Works on any Chromium-based browser: **Chrome, Microsoft Edge, Brave, Opera, Vivaldi**.

🔗 **Live Site**: [wordle-solver-extension.vercel.app](https://wordle-solver-extension.vercel.app/)  
🛒 **Chrome Web Store**: [Wordle Auto-Solver](https://chromewebstore.google.com/detail/pijohklighjacgongfanehhmhodmlcon)  
🔒 **Privacy Policy**: [wordle-solver-extension.vercel.app/privacy.html](https://wordle-solver-extension.vercel.app/privacy.html)

---

## 🚀 Features

- **One-Click Auto-Solver**: Click the extension icon on NYT Wordle and watch it solve the puzzle automatically — no manual input needed.
- **Shannon Entropy Engine**: Calculates expected information gain (in bits) for candidate and non-candidate probe words to always pick the optimal next guess.
- **Smart Probe Mode**: Uses English letter frequency weights to evaluate probe words, breaking tricky word traps (`_IGHT`, `_OUND`) in a single guess.
- **Datamuse Live API**: Dynamically fetches valid word candidates from the Datamuse API using known letter patterns — no local dictionary file needed.
- **Auto-Dismiss Popups**: Automatically closes NYT cookie banners, privacy popups, side navigation menus, and login promo modals before and during solving.
- **Mid-Game Resume**: Reads existing tile colours on the board and picks up from wherever you left off.
- **Rejection Auto-Clear**: Detects when Wordle rejects a word (invalid dictionary entry), clears the row with Backspace, and retries automatically.
- **20 Curated Openers**: Randomly selects from 20 top mathematical and popular player opening guesses (`SALET`, `ADIEU`, `TRACE`, `AUDIO`, `CRANE`...) for maximum first-turn variety and efficiency.

---

## 📁 Project Structure

```
wordle-solver-extension/
├── extension/                  # The Chrome Extension (Manifest V3)
│   ├── manifest.json           # Extension config, permissions & content script registration
│   ├── popup.html              # Extension popup UI
│   ├── popup.css               # Popup styling
│   ├── popup.js                # Popup logic (sends START_SOLVER message to content script)
│   ├── content.js              # Core solver engine injected into NYT Wordle page
│   └── icons/                  # Extension icons (16, 32, 48, 128px)
├── assets/                     # Static assets for the landing page
│   ├── logos/                  # Browser logo SVGs (Chrome, Edge, Brave, Opera)
│   └── ninaad.png              # Creator photo
├── index.html                  # Vercel landing page
├── privacy.html                # Privacy policy page
├── style.css                   # Landing page styles
├── script.js                   # Interactive Wordle board demo animation
└── README.md
```

---

## 🛠️ How to Install the Extension

### Direct Store Install (Recommended)

1. Visit the [Wordle Auto-Solver on Chrome Web Store](https://chromewebstore.google.com/detail/pijohklighjacgongfanehhmhodmlcon).
2. Click **Add to Chrome** (or **Add to Edge / Brave / Opera**).
3. Open [NYT Wordle](https://www.nytimes.com/games/wordle/index.html), click the extension icon in your browser bar, and hit **🚀 Run Auto-Solver**.

---

### Manual Developer Install (Unpacked)

1. Clone or download this repository.
2. Open your browser's extensions page (`chrome://extensions` or `edge://extensions`).
3. Toggle **Developer mode** ON in the top-right corner.
4. Click **Load unpacked** and select the `extension/` directory.

---

## 💡 How It Works

The solver evaluates guesses by maximising **Shannon Entropy** $H(X)$:

$$H(X) = - \sum_{i} P(x_i) \log_2 P(x_i)$$

For each legal candidate word, it simulates how the remaining candidates would be split across all possible 243 colour feedback patterns ($3^5$). The word that produces the most uniform distribution — and thus the highest expected information gain in bits — is chosen as the next guess.

When candidates share common letter patterns (e.g. `_IGHT` or `_OUND`), the engine evaluates non-candidate probe words weighted by English letter frequency to test multiple letters at once and resolve the puzzle in 3–4 guesses.

---

## 🎯 Top Optimal Opening Guesses

To skip the expensive first-turn calculation (which would require evaluating ~100M word pairs), the solver randomly selects from a curated list of 20 top mathematical and popular player openers:

```js
const TOP_OPENERS = [
  "SALET", "TRACE", "CRANE", "CRATE", "SLATE",
  "STARE", "RAISE", "SNARE", "AROSE", "LEAST",
  "ADIEU", "AUDIO", "ARISE", "HOUSE", "TRAIN",
  "IRATE", "GREAT", "HEART", "DREAM", "OCEAN"
];
```

### Why these words?

1. **Entropy Ranking**: Based on Information Theory research (including Grant Sanderson / 3Blue1Brown and MIT benchmarks), these words yield the highest expected information gain (~5.75–5.84 bits) across all ~13,000 legal 5-letter English words.
2. **Optimal Letter Frequencies**: Combines high-yield vowels (`E`, `A`, `I`, `O`) with top consonants (`R`, `S`, `T`, `N`, `L`).
3. **Candidate Reduction**: Any of these openers reduces the pool of ~2,309 official NYT Wordle answers to **fewer than 20 candidates on average** after just one guess.

| Word | Expected Information Gain | Avg. Candidates Remaining After Turn 1 |
| :--- | :---: | :---: |
| **SALET** | 5.836 bits | ~15 words |
| **ROATE / CRATE** | 5.828 bits | ~16 words |
| **TRACE** | 5.786 bits | ~18 words |
| **CRANE** | 5.787 bits | ~18 words |
| **SLATE** | 5.785 bits | ~18 words |
| **RAISE / ARISE** | 5.778 bits | ~19 words |
| **SNARE** | 5.760 bits | ~20 words |
| **STARE / LEAST** | 5.750 bits | ~21 words |

---

## 👤 Author

**Ninaad Saxena**
- 💼 LinkedIn: [linkedin.com/in/ninaadsaxena](https://linkedin.com/in/ninaadsaxena)
- 🐙 GitHub: [github.com/ninaadsaxena](https://github.com/ninaadsaxena)
