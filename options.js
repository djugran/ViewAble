const DEFAULT_SETTINGS = {
  enabled: true,
  readerMode: true,
  dyslexicFont: true,
  highContrast: false,
  textSize: 1,
  lineSpacing: 1,
  theme: 'auto'
};

function send(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => resolve(response));
  });
}

async function loadSettings() {
  const res = await send({ type: 'getSettings' });
  return { ...DEFAULT_SETTINGS, ...(res?.settings || {}) };
}

async function saveSettings(partial) {
  await send({ type: 'updateSettings', partial });
}

function bindControls(settings) {
  const enabled = document.getElementById('enabled');
  const readerMode = document.getElementById('readerMode');
  const dyslexicFont = document.getElementById('dyslexicFont');
  const highContrast = document.getElementById('highContrast');
  const textSize = document.getElementById('textSize');
  const lineSpacing = document.getElementById('lineSpacing');
  const theme = document.getElementById('theme');
  const resetBtn = document.getElementById('reset');

  enabled.checked = settings.enabled;
  readerMode.checked = settings.readerMode;
  dyslexicFont.checked = settings.dyslexicFont;
  highContrast.checked = settings.highContrast;
  textSize.value = settings.textSize;
  lineSpacing.value = settings.lineSpacing;
  theme.value = settings.theme;

  enabled.addEventListener('change', () =>
    saveSettings({ enabled: enabled.checked })
  );
  readerMode.addEventListener('change', () =>
    saveSettings({ readerMode: readerMode.checked })
  );
  dyslexicFont.addEventListener('change', () =>
    saveSettings({ dyslexicFont: dyslexicFont.checked })
  );
  highContrast.addEventListener('change', () =>
    saveSettings({ highContrast: highContrast.checked })
  );
  textSize.addEventListener('input', () =>
    saveSettings({ textSize: parseFloat(textSize.value) })
  );
  lineSpacing.addEventListener('input', () =>
    saveSettings({ lineSpacing: parseFloat(lineSpacing.value) })
  );
  theme.addEventListener('change', () =>
    saveSettings({ theme: theme.value })
  );

  resetBtn.addEventListener('click', async () => {
    await saveSettings(DEFAULT_SETTINGS);
    const fresh = await loadSettings();
    bindControls(fresh);
  });
}

(async () => {
  const settings = await loadSettings();
  bindControls(settings);
})();