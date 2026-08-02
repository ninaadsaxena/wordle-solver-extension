document.addEventListener('DOMContentLoaded', () => {
  const runBtn = document.getElementById('run-btn');
  const statusText = document.getElementById('status-text');
  const statusDot = document.getElementById('status-dot');

  runBtn.addEventListener('click', async () => {
    statusText.innerText = 'Solving in progress...';
    statusDot.className = 'status-dot active';
    runBtn.disabled = true;

    try {
      // Find NYT Wordle tab
      const tabs = await chrome.tabs.query({ url: 'https://www.nytimes.com/games/wordle/*' });

      if (tabs.length > 0) {
        const targetTab = tabs[0];
        await chrome.tabs.update(targetTab.id, { active: true });
        
        // Send message to content script to trigger solver
        chrome.tabs.sendMessage(targetTab.id, { action: 'START_SOLVER' }, (response) => {
          if (chrome.runtime.lastError) {
            // Inject content script manually if needed
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
        const newTab = await chrome.tabs.create({ url: 'https://www.nytimes.com/games/wordle/index.html' });
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
