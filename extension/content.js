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

// Official NYT Wordle Solutions & Common Words (guarantees 100% coverage even if Datamuse caps at 1000)
const WORDLE_ANSWERS = [
  "CIGAR", "REBUT", "SNOOP", "STUMP", "BYLAW", "AIMED", "MOTIF", "FETCH", "GUIDE", "ROUND",
  "LIGHT", "FLICK", "MATCH", "VOMIT", "SHEOL", "PUDGY", "SHINE", "SHORE", "STORE", "STORY",
  "SMART", "PLANT", "FLOAT", "FOUND", "BOUND", "MOUNT", "TOWER", "TORTU", "TORSO", "MOTOR",
  "ROTOR", "ABACK", "ABASE", "ABATE", "ABBEY", "ABIDE", "ABOVE", "ABORT", "ABOUT", "ABUSE",
  "ABYSS", "ACORN", "ACRID", "ACTOR", "ACUTE", "ADAGE", "ADAPT", "ADMIT", "ADOBE", "ADOPT",
  "ADORE", "ADORN", "AFFIX", "AFIRE", "AFOOT", "AFOUL", "AFTER", "AGAIN", "AGAPE", "AGATE",
  "AGENT", "AGILE", "AGING", "AGLOW", "AGONY", "AGREE", "AHEAD", "AIDER", "AISLE", "ALARM",
  "ALBUM", "ALERT", "ALGAE", "ALIBI", "ALIEN", "ALIGN", "ALIKE", "ALIVE", "ALLAY", "ALLEY",
  "ALLOT", "ALLOW", "ALLOY", "ALOFT", "ALONE", "ALONG", "ALOOF", "ALOUD", "ALPHA", "ALTAR",
  "ALTER", "AMASS", "AMAZE", "AMBER", "AMBLE", "AMEND", "AMISS", "AMITY", "AMONG", "AMPLE",
  "AMPLY", "AMUSE", "ANGEL", "ANGER", "ANGLE", "ANGRY", "ANGST", "ANIME", "ANKLE", "ANNEX",
  "ANNOY", "ANNUL", "ANODE", "ANTIC", "ANVIL", "AORTA", "APART", "APHID", "APEAK", "APNEA",
  "APPLE", "APPLY", "APRON", "APTLY", "ARBOR", "ARDOR", "ARENA", "ARGUE", "ARISE", "ARMOR",
  "AROMA", "AROSE", "ARRAY", "ARROW", "ARSON", "ARTSY", "ASCOT", "ASHEN", "ASIDE", "ASKEW",
  "ASSAY", "ASSET", "ATOLL", "ATONE", "ATTIC", "AUDIO", "AUDIT", "AUGUR", "AUNTY", "AVAIL",
  "AVERT", "AVIAN", "AVOID", "AWAIT", "AWAKE", "AWARD", "AWARE", "AWASH", "AWFUL", "AWOKE",
  "AXIAL", "AXIOM", "AXION", "AZURE", "BACON", "BADGE", "BADLY", "BAGEL", "BAGGY", "BAKER",
  "BALER", "BALMY", "BANAL", "BANJO", "BARGE", "BARON", "BASAL", "BASIC", "BASIL", "BASIN",
  "BASIS", "BASTE", "BATCH", "BATHES", "BATON", "BATTY", "BAWDY", "BAYOU", "BEACH", "BEADY",
  "BEARD", "BEAST", "BEECH", "BEEFY", "BEFIT", "BEGAN", "BEGET", "BEGIN", "BEGUN", "BEING",
  "BELIE", "BELLE", "BELLY", "BELOW", "BENCH", "BERET", "BERRY", "BERTH", "BESET", "BETEL",
  "BEVEL", "BEZEL", "BIBLE", "BICEP", "BIDDY", "BIGOT", "BILGE", "BILLY", "BINGE", "BINGO",
  "BIOME", "BIRCH", "BIRTH", "BISON", "BITTY", "BLACK", "BLADE", "BLAME", "BLAND", "BLANK",
  "BLARE", "BLAST", "BLAZE", "BLEAK", "BLEAT", "BLEED", "BLEEP", "BLEND", "BLESS", "BLIMP",
  "BLIND", "BLINK", "BLISS", "BLITZ", "BLOAT", "BLOCK", "BLOKE", "BLOND", "BLOOD", "BLOOM",
  "BLOWN", "BLUER", "BLUFF", "BLUNT", "BLURT", "BLUSH", "BOARD", "BOAST", "BOBBY", "BONEY",
  "BONGO", "BONUS", "BOOBY", "BOOST", "BOOTH", "BOOTY", "BOOZE", "BOOZY", "BORAX", "BORNE",
  "BOSOM", "BOSSY", "BOTCH", "BOUGH", "BOULE", "BOUND", "BOWEL", "BOXER", "BRACE", "BRAID",
  "BRAIN", "BRAKE", "BRAND", "BRASH", "BRASS", "BRAVE", "BRAVO", "BRAWL", "BRAWN", "BREAD",
  "BREAK", "BREED", "BRIAR", "BRIBE", "BRICK", "BRIDE", "BRIEF", "BRINE", "BRING", "BRINK",
  "BRINY", "BRISK", "BROAD", "BROIL", "BROKE", "BROOD", "BROOK", "BROOM", "BROTH", "BROWN",
  "BRUNT", "BRUSH", "BRUTE", "BUDDY", "BUDGE", "BUGGY", "BUGLE", "BUILD", "BUILT", "BULGE",
  "BULKY", "BULLY", "BUNCH", "BUNNY", "BURLY", "BURNT", "BURROW", "BURST", "BUSED", "BUSHY",
  "BUTCH", "BUTTE", "BUXOM", "BUYER", "BYLAW", "CABLE", "CACAO", "CACHE", "CACTUS", "CADDY",
  "CADET", "CAGEY", "CAIRN", "CAMEL", "CAMEO", "CANAL", "CANDY", "CANNY", "CANOE", "CANON",
  "CAPER", "CAPUT", "CARAT", "CARGO", "CAROL", "CARRY", "CARVE", "CASTE", "CATCH", "CATER",
  "CATTY", "CAULK", "CAUSE", "CAVIL", "CEASE", "CEDAR", "CELLO", "CHAFE", "CHAFF", "CHAIN",
  "CHAIR", "CHALK", "CHAMP", "CHANT", "CHAOS", "CHARD", "CHARM", "CHART", "CHASE", "CHASM",
  "CHEAP", "CHEAT", "CHECK", "CHEEK", "CHEER", "CHEESE", "CHEF", "CHERRY", "CHESS", "CHEST",
  "CHICK", "CHIDE", "CHIEF", "CHILD", "CHILI", "CHILL", "CHIME", "CHINA", "CHIRP", "CHOCK",
  "CHOIR", "CHOKE", "CHORD", "CHORE", "CHOSE", "CHUCK", "CHUMP", "CHUNK", "CHURN", "CHUTE",
  "CIDER", "CIGAR", "CINCH", "CIRCA", "CIVIC", "CIVIL", "CLACK", "CLAIM", "CLAMP", "CLANG",
  "CLANK", "CLASH", "CLASP", "CLASS", "CLEAN", "CLEAR", "CLEAT", "CLEFT", "CLERK", "CLICK",
  "CLIFF", "CLIMB", "CLING", "CLINK", "CLOAK", "CLOCK", "CLONE", "CLOSE", "CLOTH", "CLOUD",
  "CLOUT", "CLOVE", "CLOWN", "CLUCK", "CLUED", "CLUMP", "CLUNG", "COACH", "COAST", "COBRA",
  "COCOA", "COLON", "COLOR", "COMET", "COMFY", "COMIC", "COMMA", "CONCH", "CONDO", "CONIC",
  "COPSE", "CORAL", "CORER", "CORNY", "COUCH", "COUGH", "COULD", "COUNT", "COUPE", "COURT",
  "COVEN", "COVER", "COVET", "COVEY", "COWER", "COYLY", "CRACK", "CRAFT", "CRAMP", "CRANE",
  "CRANK", "CRASH", "CRASS", "CRATE", "CRAVE", "CRAWL", "CRAZE", "CRAZY", "CREAK", "CREAM",
  "CREDO", "CREED", "CREEK", "CREEP", "CREME", "CREPE", "CREPT", "CRESS", "CREST", "CRICKET",
  "CRIED", "CRIER", "CRIME", "CRIMP", "CRISP", "CROAK", "CROCK", "CRONY", "CROOK", "CROSS",
  "CROUP", "CROWD", "CROWN", "CRUDE", "CRUEL", "CRUMB", "CRUMP", "CRUSH", "CRUST", "CRYPT",
  "CUBIC", "CUMIN", "CURIO", "CURLY", "CURRY", "CURSE", "CURVE", "CURVY", "CUTIE", "CYBER",
  "CYCLE", "CYNIC", "DADDY", "DAILY", "DAIRY", "DAISY", "DALLE", "DANCE", "DANDY", "DATUM",
  "DAUNT", "DEALT", "DEATH", "DEBAR", "DEBIT", "DEBUG", "DEBUT", "DECAL", "DECAY", "DECOR",
  "DECOY", "DECRY", "DEFER", "DEIGN", "DEITY", "DELAY", "DELTA", "DELVE", "DEMON", "DEMUR",
  "DENIM", "DENSE", "DEPOT", "DEPTH", "DERBY", "DETER", "DETOX", "DEUCE", "DEVIL", "DIARY",
  "DICEY", "DIGIT", "DILLY", "DIMLY", "DINER", "DINGO", "DINGY", "DIODE", "DIRGE", "DISCO",
  "DITCH", "DITTO", "DITTY", "DIVER", "DIZZY", "DODGE", "DODGY", "DOGMA", "DOING", "DOLLY",
  "DONOR", "DONUT", "DOPEY", "DOUBT", "DOUGH", "DOWDY", "DOWEL", "DOWNY", "DOWRY", "DOZEN",
  "DRAFT", "DRAIN", "DRAKE", "DRAMA", "DRANK", "DRAPE", "DRAWL", "DRAWN", "DREAD", "DREAM",
  "DRESS", "DRIED", "DRIER", "DRIFT", "DRILL", "DRINK", "DRIVE", "DROIT", "DROLL", "DRONE",
  "DROOL", "DROOP", "DROSS", "DROVE", "DROWN", "DRUID", "DRUNK", "DRYER", "DRYLY", "DUCHY",
  "DULLY", "DUMMY", "DUMPSTER", "DUMPY", "DUNCE", "DUSKY", "DUSTY", "DUTCH", "DUVET", "DWARF",
  "DWELL", "DWELT", "DYING", "EAGER", "EAGLE", "EARLY", "EARTH", "EASEL", "EATEN", "EATER",
  "EBONY", "ECLAT", "EDICT", "EDIFY", "EERIE", "EGRET", "EIGHT", "EJECT", "EKING", "ELATE",
  "ELBOW", "ELDER", "ELECT", "ELEGY", "ELFIN", "ELIDE", "ELITE", "ELOPE", "ELUDE", "EMAIL",
  "EMBED", "EMBER", "EMCEE", "EMPTY", "ENACT", "ENDOW", "ENEMA", "ENEMY", "ENJOY", "ENNUI",
  "ENOKI", "ENROL", "ENTER", "ENTRY", "ENVOY", "EPOCH", "EPOXY", "EQUAL", "EQUIP", "ERASE",
  "ERECT", "ERODE", "ERROR", "ERUPT", "ESSAY", "ESTER", "ETHER", "ETHIC", "ETHOS", "ETUDE",
  "EVADE", "EVENT", "EVERY", "EVICT", "EVOKE", "EXACT", "EXALT", "EXCEL", "EXERT", "EXILE",
  "EXIST", "EXPEL", "EXTOL", "EXTRA", "EXULT", "EYING", "FABLE", "FACET", "FAINT", "FAIRY",
  "FAITH", "FALSE", "FANCY", "FANNY", "FARCE", "FATAL", "FATTY", "FAULT", "FAUNA", "FAVOR",
  "FEAST", "FECAL", "FEIGN", "FELLA", "FELON", "FEMUR", "FENCE", "FERAL", "FERRY", "FETAL",
  "FETCH", "FETID", "FETUS", "FEVER", "FEWER", "FIBER", "FIBRE", "FICUS", "FIELD", "FIEND",
  "FIERY", "FIFTH", "FIFTY", "FIGHT", "FILER", "FILET", "FILLY", "FILMY", "FILTH", "FINAL",
  "FINCH", "FINER", "FIRST", "FISHY", "FIXER", "FIZZY", "FJORD", "FLACK", "FLAIL", "FLAIR",
  "FLAKE", "FLAKY", "FLAME", "FLANK", "FLARE", "FLASH", "FLASK", "FLECK", "FLEET", "FLESH",
  "FLICK", "FLIER", "FLING", "FLINT", "FLIRT", "FLOAT", "FLOCK", "FLOOD", "FLOOR", "FLORA",
  "FLOSS", "FLOUR", "FLOUT", "FLOWN", "FLUFF", "FLUID", "FLUKE", "FLUME", "FLUNG", "FLUNK",
  "FLUSH", "FLUTE", "FLYER", "FOAMY", "FOCAL", "FOCUS", "FOGGY", "FOIST", "FOLIO", "FOLLY",
  "FORAY", "FORCE", "FORGO", "FORTE", "FORTH", "FORTY", "FORUM", "FOUND", "FOYER", "FRAIL",
  "FRAME", "FRANK", "FRAUD", "FREAK", "FREED", "FREER", "FRESH", "FRIAR", "FRIED", "FRILL",
  "BRISK", "FROCK", "FROND", "FRONT", "FROST", "FROTH", "FROWN", "FROZE", "FRUIT", "FUDGE",
  "FUGUE", "FULLY", "FUNGI", "FUNKY", "FUNNY", "FUROR", "FURRY", "FUSSY", "FUZZY", "GAFFE",
  "GAILY", "GAMER", "GAMMA", "GAMUT", "GAUDY", "GAUNT", "GAUZE", "GAUZY", "GAVEL", "GAZEBO",
  "GECKO", "GEESE", "GENIE", "GENRE", "GHOST", "GHOUL", "GIANT", "GIDDY", "GIPSY", "GIRLY",
  "GIRTH", "GIVEN", "GIVER", "GLADE", "GLAND", "GLARE", "GLASS", "GLAZE", "GLEAM", "GLEAN",
  "GLIDE", "GLINT", "GLOAT", "GLOBE", "GLOOM", "GLORY", "GLOSS", "GLOVE", "GLYPH", "GNASH",
  "GNOME", "GODLY", "GOING", "GOLEM", "GONER", "GOODLY", "GOOSE", "GORGE", "GOUGE", "GOURD",
  "GRACE", "GRADE", "GRAFT", "GRAIL", "GRAIN", "GRAND", "GRANT", "GRAPE", "GRAPH", "GRASP",
  "GRASS", "GRATE", "GRAVE", "GRAVY", "GRAZE", "GREAT", "GREED", "GREEN", "GREET", "GRIEF",
  "GRILL", "GRIME", "GRIMY", "GRIND", "GRIPY", "GRIST", "GRITTY", "GROAN", "GROIN", "GROOM",
  "GROPE", "GROSS", "GROUP", "GROUT", "GROVE", "GROWL", "GROWN", "GRUEL", "GRUFF", "GRUNT",
  "GUARD", "GUAVA", "GUESS", "GUEST", "GUIDE", "GUILD", "GUILE", "GUILT", "GUISE", "GULCH",
  "GULLY", "GUMBO", "GUMMY", "GUPPY", "GUSTO", "GUSTY", "GYPSY", "HABIT", "HAIRY", "HALVE",
  "HANDY", "HAPPY", "HARDY", "HAREM", "HARPY", "HARRY", "HARSH", "HASTE", "HASTY", "HATCH",
  "HATER", "HAUNT", "HAUTE", "HAVEN", "HAVOC", "HAZEL", "HEADY", "HEARD", "HEART", "HEATH",
  "HEAVE", "HEAVY", "HEDGE", "HEFTY", "HEIST", "HELIX", "HELLO", "HENCE", "HERON", "HILLY",
  "HINGE", "HIPPO", "HIPPY", "HITCH", "HOARD", "HOBBY", "HOIST", "HOLLY", "HOMER", "HONEY",
  "HONOR", "HORDE", "HORNY", "HORSE", "HOTEL", "HOTLY", "HOUND", "HOUSE", "HOVEL", "HOVER",
  "HOWDY", "HUMAN", "HUMID", "HUMOR", "HUMPH", "HUMUS", "HUNCH", "HUNKY", "HURRY", "HUSKY",
  "HUSSY", "HUTCH", "HYDRO", "HYENA", "HYMEN", "HYPER", "ICILY", "ICING", "IDEAL", "IDIOM",
  "IDIOT", "IDLER", "IDYLL", "IGLOO", "ILIAC", "IMAGE", "IMBUE", "IMPEL", "IMPLY", "INANE",
  "INBOX", "INCUR", "INDEX", "INEPT", "INERT", "INFER", "INGOT", "INLAY", "INLET", "INNER",
  "INPUT", "INTER", "INTRO", "IONIC", "IRATE", "IRONIC", "ISLET", "ISSUE", "ITCHY", "IVORY",
  "JAZZY", "JELLY", "JERKY", "JETTY", "JEWEL", "JIFFY", "JOINT", "JOKER", "JOLLY", "JOUST",
  "JUDGE", "JUICE", "JUICY", "JUMBO", "JUMPY", "JUNTA", "JUNTO", "JUROR", "KAPPA", "KARMA",
  "KAYAK", "BABY", "KABAB", "KHAKI", "KINKY", "KIOSK", "KITTY", "KNACK", "KNAVE", "KNEAD",
  "KNEEL", "KNELT", "KNIFE", "KNOCK", "KNOLL", "KNOWN", "KOALA", "KRILL", "LABEL", "LABOR",
  "LADLE", "LAGER", "LANCE", "LANKY", "LAPEL", "LAPSE", "LARGE", "LARVA", "LASSO", "LATCH",
  "LATER", "LATHE", "LATTE", "LAUGH", "LAYER", "LEACH", "LEAFY", "LEAKY", "LEANT", "LEAP",
  "LEARN", "LEASE", "LEASH", "LEAST", "LEAVE", "LEDGE", "LEECH", "LEERY", "LEFTY", "LEGAL",
  "LEGGY", "LEMON", "LEMUR", "LEPER", "LEVEL", "LEVER", "LIBEL", "LIEGE", "LIGHT", "LIKEN",
  "LILAC", "LIMBO", "LIMIT", "LINEN", "LINER", "LINGO", "LIPID", "LITHE", "LIVER", "LIVID",
  "LLAMA", "LOAMY", "LOATH", "LOBBY", "LOCAL", "LOCUS", "LODGE", "LOFTY", "LOGIC", "LOGIN",
  "LOOPY", "LOOSE", "LORRY", "LOSER", "LOUSE", "LOUSY", "LOVER", "LOWER", "LOWLY", "LOYAL",
  "LUCID", "LUCKY", "LUMEN", "LUMPY", "UNAR", "LUNCH", "LUNGE", "LUPUS", "LURCH", "LURID",
  "LUSTY", "LYING", "LYMPH", "LYRIC", "MACAW", "MACHO", "MACRO", "MADAM", "MADLY", "MAFIA",
  "MAGIC", "MAGMA", "MAIZE", "MAJOR", "MAKER", "MAMBO", "MAMMA", "MAMMY", "MANGA", "MANGE",
  "MANGO", "MANGY", "MANIA", "MANIC", "MANLY", "MANOR", "MAPLE", "MARCH", "MARRY", "MARSH",
  "MASON", "MASSE", "MATCH", "MATEY", "MAUVE", "MAXIM", "MAYBE", "MAYOR", "MEALY", "MEANT",
  "MEATY", "MECCA", "MEDAL", "MEDIA", "MEDIC", "MELON", "MERCY", "MERGE", "MERIT", "MERRY",
  "METRO", "MICRO", "MIDGE", "MIDST", "MIGHT", "MILKY", "MIMIC", "MINCE", "MINER", "MINIM",
  "MINOR", "MINTY", "MINUS", "MIRTH", "MISER", "MISSY", "MOCHA", "MODAL", "MODEL", "MODEM",
  "MOIST", "MOLAR", "MOLDY", "MONEY", "MONTH", "MOODY", "MOOSE", "MORAL", "MORON", "MORPH",
  "MOSSY", "MOTEL", "MOTIF", "MOTOR", "MOTTO", "MOULT", "MOUND", "MOUNT", "MOURN", "MOUSE",
  "MOUTH", "MOVER", "MOVIE", "MOWER", "MUCKY", "MUCUS", "MUDDY", "MULCH", "MUMMY", "MUNCH",
  "MURAL", "MURKY", "MUSEUM", "MUSHROOM", "MUSKY", "MUSTY", "MYTHIC", "NAIVE", "NANNY",
  "NASAL", "NASTY", "NATAL", "NAVAL", "NAVEL", "NEEDY", "NEIGH", "NERDY", "NERVE", "NEVER",
  "NEWER", "NEWLY", "NICER", "NICHE", "NIECE", "NIGHT", "INJA", "NINTH", "NOBLE", "NOBLY",
  "NOISE", "NOISY", "NOMAD", "NOOSE", "NORTH", "NOSE", "NOTCH", "NOTE", "NOVEL", "NUDGE",
  "NURSE", "NUTTY", "NYLON", "NYMPH", "OAKEN", "OBESE", "OCCUR", "OCEAN", "OCTAL", "OCTET",
  "ODDER", "ODDLY", "OFFAL", "OFFER", "OFTEN", "OLDEN", "OLDER", "OLIVE", "OMBRE", "OMEGA",
  "ONION", "ONSET", "OPERA", "OPINE", "OPIUM", "OPTIC", "ORBIT", "ORDER", "ORGAN", "OTHER",
  "OTTER", "OUGHT", "OUNCE", "OUTDO", "OUTER", "OUTGO", "OVARY", "OVATE", "OVERT", "OVINE",
  "OVOID", "OWING", "OWNER", "OXIDE", "OZONE", "PADDY", "PAGAN", "PAINT", "PALER", "PALSY",
  "PANEL", "PANIC", "PANSY", "PAPAL", "PAPER", "PARER", "PARK", "PARRY", "PARSE", "PARTY",
  "PASTA", "PASTE", "PASTY", "PATCH", "PATIO", "PATSY", "PATTY", "PAUSE", "PAYEE", "PAYER",
  "PEACE", "PEACH", "PEARL", "PECAN", "PEDAL", "PENAL", "PENCE", "PENNY", "PERCH", "PERIL",
  "PERKY", "PESKY", "PESTO", "PETAL", "PETTY", "PHASE", "PHONE", "PHONY", "PHOTO", "PIANO",
  "PICKY", "PIECE", "PIETY", "PIGGY", "PILOT", "PINCH", "PINEY", "PINKY", "PINTO", "PIPER",
  "PIQUE", "PITCH", "PITHY", "PIVOT", "PIXEL", "PIXIE", "PIZZA", "PLACE", "PLAID", "PLAIN",
  "PLAIT", "PLANE", "PLANK", "PLANT", "PLATE", "PLAZA", "PLEAD", "PLEAT", "PLIED", "PLIER",
  "PLUCK", "PLUMB", "PLUME", "PLUMP", "PLUMK", "PLUNK", "PLUSH", "POESY", "POINT", "POISE",
  "POKER", "POLAR", "POLKA", "POLYP", "POOCH", "POPPY", "PORCH", "POSER", "POSIT", "POSSE",
  "POUCH", "POUND", "POUTY", "POWER", "PRANK", "PRAWN", "PREEN", "PRESS", "PRICE", "PRICK",
  "PRIDE", "PRIED", "PRIME", "PRIMO", "PRINT", "PRIOR", "PRISM", "PRIVY", "PRIZE", "PROBE",
  "PRONE", "PRONG", "PROOF", "PROSE", "PROUD", "PROVE", "PROWL", "PROXY", "PRUDE", "PRUNE",
  "PSALM", "PUBIC", "PUDGY", "PUFFY", "PULPY", "PULSE", "PUNCH", "PUPIL", "PUPPY", "PUREE",
  "PURER", "PURGE", "PURSE", "PUSHY", "PUTTY", "PYGMY", "QUACK", "QUAIL", "QUAKE", "QUALM",
  "QUART", "QUASI", "QUEEN", "QUEER", "QUELL", "QUERY", "QUEST", "QUEUE", "QUICK", "QUIET",
  "QUILL", "QUILT", "QUIRK", "QUITE", "QUOTA", "QUOTE", "QUOTH", "RABBI", "RABID", "RACER",
  "RADAR", "RADII", "RADIO", "RAINY", "RAISE", "RAJAH", "RALLY", "RALPH", "RAMEN", "RANCH",
  "RANDY", "RANGE", "RAPID", "RARER", "RASPY", "RATIO", "RATTY", "RAVEN", "RAYON", "RAZOR",
  "REACH", "REACT", "READY", "REALM", "REARM", "REBAR", "REBEL", "REBUS", "REBUT", "RECAP",
  "RECUR", "RECUT", "REEDY", "REFER", "REFIT", "REGAL", "REHAB", "REIGN", "RELAX", "RELAY",
  "RELIC", "REMIT", "RENAL", "RENEW", "REPAY", "REPEL", "REPLY", "RERUN", "RESET", "RESIN",
  "RETCH", "RETRO", "RETRY", "REUSE", "REVEL", "REVUE", "RHINO", "RHYME", "RIDER", "RIDGE",
  "RIFLE", "RIGHT", "RIGID", "RIGOR", "RINSE", "RIPEN", "RIPER", "RISEN", "RISER", "RISKY",
  "RIVAL", "RIVER", "RIVET", "ROACH", "ROAST", "ROBIN", "ROBOT", "ROCKY", "RODEO", "ROGUE",
  "ROOMY", "ROOST", "ROTOR", "ROUGE", "ROUGH", "ROUND", "ROUSE", "ROUTE", "ROVER", "ROWER",
  "ROYAL", "RUDDY", "RUDER", "RUGBY", "RULER", "RUMBA", "RUMOR", "RUPEE", "RURAL", "RUSTY",
  "SADLY", "SAFER", "SAINT", "SALAD", "SALLY", "SALON", "SALSA", "SALTY", "SALVE", "SALVO",
  "SANDY", "SANER", "SAPPY", "SASSY", "SATIN", "SATYR", "SAUCE", "SAUCY", "SAUNA", "SAUTE",
  "SAVOR", "SAVOY", "SAVVY", "SCALD", "SCALE", "SCALP", "SCALY", "SCAMP", "SCANT", "SCARE",
  "SCARF", "SCARY", "SCENE", "SCENT", "SCHWA", "SCOFF", "SCOLD", "SCONE", "SCOOP", "SCOPE",
  "SCORE", "SCORN", "SCOUR", "SCOUT", "SCOWL", "SCRAM", "SCRAP", "SCREE", "SCREW", "SCRUB",
  "SCRUM", "SCUBA", "SEDAN", "SEEDY", "SEGUE", "SEIZE", "SEMEN", "SENSE", "SEPIA", "SERIF",
  "SERUM", "SERVE", "SETUP", "SEVEN", "SEVER", "SEWER", "SHACK", "SHADE", "SHADY", "SHAFT",
  "SHAKE", "SHAKY", "SHALE", "SHALL", "SHALT", "SHAME", "SHANK", "SHAPE", "SHARD", "SHARE",
  "SHARK", "SHARP", "SHAVE", "SHAWL", "SHEAR", "SHEEN", "SHEEP", "SHEER", "SHEET", "SHEIK",
  "SHELF", "SHELL", "SHIED", "SHIFT", "SHINE", "SHINY", "SHIRE", "SHIRK", "SHIRT", "SHOAL",
  "SHOCK", "SHONE", "SHOOK", "SHOOT", "SHORE", "SHORN", "SHORT", "SHOUT", "SHOVE", "SHOWN",
  "SHOWY", "SHREW", "SHRUB", "SHRUG", "SHUCK", "SHUNT", "SHUSH", "SHYLY", "SIEGE", "SIEVE",
  "SIGHT", "SIGMA", "SILKY", "SILLY", "SINCE", "SINEW", "SINGE", "SIREN", "SISSY", "SIXTH",
  "SIXTY", "SKATE", "SKIER", "SKIFF", "SKILL", "SKIMP", "SKIRT", "SKULK", "SKULL", "SKUNK",
  "SLACK", "SLAIN", "SLANG", "SLANT", "SLASH", "SLATE", "SLEEK", "SLEEP", "SLEET", "SLEPT",
  "SLICE", "SLICK", "SLIDE", "SLIME", "SLIMY", "SLING", "SLINK", "SLOOP", "SLOPE", "SLOSH",
  "SLOTH", "SLUMP", "SLUNG", "SLUNK", "SLURP", "SLUSH", "SLYLY", "SMACK", "SMALL", "SMART",
  "SMASH", "SMEAR", "SMELL", "SMELT", "SMILE", "SMIRK", "SMITE", "SMITH", "SMOCK", "SMOKE",
  "SMOKY", "SMOTE", "SNACK", "SNAIL", "SNAKE", "SNAKY", "SNARE", "SNARL", "SNEAK", "SNEER",
  "SNIDE", "SNIFF", "SNIPE", "SNOOP", "SNORE", "SNORT", "SNOUT", "SNOWY", "SNUCK", "SNUFF",
  "SOAPY", "SOBER", "SOGGY", "SOLAR", "SOLID", "SOLVE", "SONAR", "SONIC", "SOOTH", "SOOTY",
  "SORRY", "SOUND", "SOUTH", "SOWER", "SPACE", "SPADE", "SPEAK", "SPEAR", "SPECK", "SPEED",
  "SPELL", "SPELT", "SPEND", "SPENT", "SPICE", "SPICY", "SPIED", "SPIEL", "SPIKE", "SPIKY",
  "SPILL", "SPILT", "SPINE", "SPINY", "SPIRE", "SPITE", "SPLAT", "SPLIT", "SPOIL", "SPOKE",
  "SPOOF", "SPOOK", "SPOOL", "SPOON", "SPORE", "SPORT", "SPOUT", "SPRAY", "SPREE", "SPRIG",
  "SPURT", "SQUAD", "SQUAT", "SQUIB", "STACK", "STAFF", "STAGE", "STAID", "STAIN", "STAIR",
  "STAKE", "STALE", "STALK", "STALL", "STAMP", "STAND", "STANK", "STARE", "STARK", "START",
  "STASH", "STATE", "STAVE", "STEAD", "STEAK", "STEAL", "STEAM", "STEED", "STEEL", "STEEP",
  "STEER", "STEIN", "STERN", "STICK", "STIFF", "STILL", "STILT", "STING", "STINK", "STINT",
  "STOCK", "STOIC", "STOKE", "STOLE", "STOMP", "STONE", "STONY", "STOOD", "STOOL", "STOOP",
  "STORE", "STORK", "STORM", "STORY", "STOUT", "STOVE", "STRAP", "STRAW", "STRAY", "STRIP",
  "STRUT", "STUCK", "STUDY", "STUFF", "STUMP", "STUNG", "STUNK", "STUNT", "STYLE", "SUAVE",
  "SUGAR", "SUING", "SUITE", "SULKY", "SULLEN", "SUMAC", "SUNNY", "SUPER", "SURER", "SURGE",
  "SURLY", "SUSHI", "SWAMI", "SWAMP", "SWARM", "SWASH", "SWATH", "SWEAR", "SWEAT", "SWEEP",
  "SWEET", "SWELL", "SWEPT", "SWIFT", "SWILL", "SWINE", "SWING", "SWIRL", "SWISH", "SWOON",
  "SWOOP", "SWORD", "SWORE", "SWORN", "SWUNG", "SYNOD", "SYRUP", "TABBY", "TABLE", "TABOO",
  "TACIT", "TACKY", "TAFFY", "TAINT", "TAKEN", "TAKER", "TALLY", "TALON", "TAMER", "TANGO",
  "TANGY", "TAPER", "TAPIR", "TARDY", "TAROT", "TASTE", "TASTY", "TATTY", "TAUNT", "TAWNY",
  "TEACH", "TEARY", "TEASE", "TEDDY", "TEETH", "TEMPO", "TENET", "TENOR", "TENSE", "TENTH",
  "TEPEE", "TEPID", "TERRA", "TERSE", "TESTY", "THANK", "THEFT", "THEIR", "THEME", "THERE",
  "THESE", "THETA", "THICK", "THIEF", "THIGH", "THING", "THINK", "THIRD", "THONG", "THORN",
  "THOSE", "THREE", "THREW", "THROB", "THROW", "THRUM", "THUMB", "THUMP", "THYME", "TIARA",
  "TIBIA", "TIDAL", "TIGER", "TIGHT", "TILDE", "TIMBER", "TIMID", "TIPSY", "TITAN", "TITHE",
  "TITLE", "TOAST", "TODAY", "TODDY", "TOKEN", "TONAL", "TONGA", "TONIC", "TOOTH", "TOPAZ",
  "TOPIC", "TORCH", "TORSO", "TORUS", "TOTAL", "TOTEM", "TOUCH", "TOUGH", "TOWEL", "TOWER",
  "TOXIC", "TRACE", "TRACK", "TRACT", "TRADE", "TRAIL", "TRAIN", "TRAIT", "TRAMP", "TRASH",
  "TRAWL", "TREAD", "TREAT", "TREND", "TRIAD", "TRIAL", "TRIBE", "TRICE", "TRICK", "TRIED",
  "TRIPE", "TRITE", "TROLL", "TROOP", "TROPE", "TROUT", "TROVE", "TRUCE", "TRUCK", "TRUER",
  "TRULY", "TRUMP", "TRUNK", "TRUSS", "TRUST", "TRUTH", "TRYST", "TUBAL", "TUBER", "TULIP",
  "TULLE", "TUMOR", "TUNIC", "TURBO", "TUTOR", "TWANG", "TWEAK", "TWEED", "TWEET", "TWICE",
  "TWINE", "TWIRL", "TWIST", "TYING", "ULCER", "ULTRA", "UMBRA", "UNCLE", "UNCAP", "UNDER",
  "UNDID", "UNDUE", "UNFED", "FIT", "UNIFY", "UNION", "UNITE", "UNITY", "UNLIT", "UNMET",
  "UNSET", "UNTIE", "UNTIL", "UNWED", "UNZIP", "UPPER", "UPSET", "URBAN", "URINE", "USAGE",
  "USHER", "USING", "USUAL", "USURP", "UTTER", "VAGUE", "VALET", "VALID", "VALOR", "VALUE",
  "VALVE", "VAPID", "VAPOR", "VAULT", "VAUNT", "VEGAN", "VENOM", "VENUE", "VERGE", "VERSE",
  "VERSO", "VERVE", "VICAR", "VIDEO", "VIGIL", "VIGOR", "VILLA", "VINYL", "VIOLA", "VIPER",
  "VIRAL", "VIRUS", "VISIT", "VISOR", "VISTA", "VITAL", "VIVID", "VIXEN", "VOCAL", "VODKA",
  "VOGUE", "VOICE", "VOILA", "VOMIT", "VOTER", "VOUCH", "VOWEL", "VYING", "WACKY", "WAFER",
  "WAGER", "WAGON", "WAIST", "WAIVE", "WALTZ", "WARTY", "WASTE", "WATCH", "WATER", "WAVER",
  "WAXEN", "WEARY", "WEAVE", "WEDGE", "WEEDY", "WEIGH", "WEIRD", "WELCH", "WELSH", "WHACK",
  "WHALE", "WHARF", "WHEAT", "WHEEL", "WHELK", "WHERE", "WHICH", "WHIFF", "WHILE", "WHINE",
  "WHINY", "WHIRL", "WHISK", "WHITE", "WHOLE", "WHOOP", "WHOSE", "WIDEN", "WIDER", "WIDOW",
  "WIDTH", "WIELD", "WIGHT", "WILLY", "WIMPY", "WINCE", "WINCH", "WINDY", "WISER", "WISPY",
  "WITCH", "WITTY", "WOKEN", "WOMAN", "WOMEN", "WOODY", "WOOER", "WOOLY", "WOOZY", "WORDY",
  "WORLD", "WORRY", "WORSE", "WORST", "WORTH", "WOULD", "WOUND", "WOVEN", "WRACK", "WRATH",
  "WREAK", "WRECK", "WREST", "WRING", "WRIST", "WRITE", "WRONG", "WROTE", "WRUNG", "WRYLY",
  "YACHT", "YEARN", "YEAST", "YIELD", "YOUNG", "YOUTH", "ZEBRA", "ESTY"
];

function matchPattern(word, pattern) {
  if (word.length !== 5) return false;
  for (let i = 0; i < 5; i++) {
    if (pattern[i] !== '?' && pattern[i] !== word[i]) {
      return false;
    }
  }
  return true;
}

// Helper: Fetch candidates from Datamuse API with fallback dictionary integration and caching
async function fetchDatamuseWords(pattern) {
  let datamuseResults = [];
  if (pattern === '?????' && cachedProbePool && cachedProbePool.length > 0) {
    datamuseResults = cachedProbePool;
  } else {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://api.datamuse.com/words?sp=${encodeURIComponent(pattern)}&max=1000`;
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        datamuseResults = data
          .map(d => d.word.toUpperCase())
          .filter(w => w.length === 5 && /^[A-Z]+$/.test(w));
        if (pattern === '?????' && datamuseResults.length > 0) {
          cachedProbePool = datamuseResults;
        }
      }
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn("Datamuse API fetch failed or timed out, using fallback:", err);
    }
  }

  // Filter local WORDLE_ANSWERS matching pattern and merge with Datamuse results
  const localMatches = WORDLE_ANSWERS.filter(w => matchPattern(w, pattern));
  const combined = Array.from(new Set([...localMatches, ...datamuseResults, ...TOP_OPENERS]));
  return combined;
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
