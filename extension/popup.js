document.addEventListener('DOMContentLoaded', () => {
  const runBtn = document.getElementById('run-btn');
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');

  runBtn.addEventListener('click', async () => {
    statusText.innerText = 'Solving in progress...';
    statusDot.className = 'status-dot active';
    runBtn.disabled = true;

    try {
      // 1. First check currently active tab
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      let targetTab = null;

      if (activeTab && activeTab.url && activeTab.url.includes('nytimes.com/games/wordle')) {
        targetTab = activeTab;
      } else {
        // 2. Otherwise query any open NYT Wordle tab (with or without www)
        const tabs = await chrome.tabs.query({ url: '*://*.nytimes.com/games/wordle/*' });
        const tabsNoWww = await chrome.tabs.query({ url: '*://nytimes.com/games/wordle/*' });
        const allMatching = [...tabs, ...tabsNoWww];
        if (allMatching.length > 0) {
          targetTab = allMatching[0];
          await chrome.tabs.update(targetTab.id, { active: true });
        }
      }

      if (targetTab) {
        // Send message to content script to trigger solver
        chrome.tabs.sendMessage(targetTab.id, { action: 'START_SOLVER' }, (response) => {
          if (chrome.runtime.lastError) {
            // Inject content script manually if script wasn't pre-injected
            chrome.scripting.executeScript({
              target: { tabId: targetTab.id },
              files: ['content.js']
            }, () => {
              chrome.tabs.sendMessage(targetTab.id, { action: 'START_SOLVER' });
            });
          }
        });
      } else {
        // Create new tab to Wordle
        await chrome.tabs.create({ url: 'https://www.nytimes.com/games/wordle/index.html' });
        statusText.innerText = 'Opening NYT Wordle...';
      }
    } catch (err) {
      console.error(err);
      statusText.innerText = 'Error launching solver';
      statusDot.className = 'status-dot error';
      runBtn.disabled = false;
    }
  });
});
