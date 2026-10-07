document.addEventListener('DOMContentLoaded', () => {
  const btnReader = document.getElementById('reader-mode');
  const btnSummarize = document.getElementById('summarize');
  const btnDyslexic = document.getElementById('toggle-dyslexic');
  const btnContrast = document.getElementById('toggle-contrast');
  const btnIncrease = document.getElementById('increase-text');
  const btnDecrease = document.getElementById('decrease-text');
  const btnReset = document.getElementById('reset-text');
  const btnReadAloud = document.getElementById('read-aloud');
  const btnQuiz = document.getElementById('quiz-button');

  const summarySection = document.getElementById('summary-section');
  const summaryText = document.getElementById('summary-text');

  const tabMain = document.getElementById('tab-main');
  const tabSettings = document.getElementById('tab-settings');
  const panelMain = document.getElementById('panel-main');
  const panelSettings = document.getElementById('panel-settings');

  const voiceToggle = document.getElementById('voice-toggle');
  const voiceVolume = document.getElementById('voice-volume');
  const voiceSpeed = document.getElementById('voice-speed');
  const languageSelect = document.getElementById('language-select');

  let availableVoices = [];
  let currentSettings = {
    gender: 'male',
    volume: 1,
    rate: 1,
    language: 'English'
  };

  let resolvedVoices = {
    male: null,
    female: null
  };

  function sendToActiveTab(message, callback) {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return;
      chrome.tabs.sendMessage(tabs[0].id, message, response => {
        if (chrome.runtime.lastError) {
          // Content script not loaded - ignore silently or show user-friendly message
          console.warn('Content script not available:', chrome.runtime.lastError.message);
          if (callback) {
            callback(null);
          }
          return;
        }
        if (callback) {
          callback(response);
        }
      });
    });
  }

  function showMain() {
    tabMain.classList.add('active');
    tabSettings.classList.remove('active');
    panelMain.hidden = false;
    panelSettings.hidden = true;
  }

  function showSettings() {
    tabSettings.classList.add('active');
    tabMain.classList.remove('active');
    panelMain.hidden = true;
    panelSettings.hidden = false;
  }

  tabMain.addEventListener('click', showMain);
  tabSettings.addEventListener('click', showSettings);

  function categorizeTtsVoice(v) {
    const name = (v.voiceName || '').toLowerCase();
    const lang = (v.lang || '').toLowerCase();

    if (
      name.includes('male') ||
      name.includes('david') ||
      name.includes('michael') ||
      name.includes('daniel') ||
      name.includes('george')
    ) {
      return 'male';
    }
    if (
      name.includes('female') ||
      name.includes('zira') ||
      name.includes('susan') ||
      name.includes('zoe') ||
      name.includes('emma') ||
      name.includes('jenny')
    ) {
      return 'female';
    }
    if (lang.startsWith('en')) {
      return 'other';
    }
    return 'other';
  }

  function resolveMaleFemaleVoices(voices) {
    let male = null;
    let female = null;

    voices.forEach(v => {
      if (!v.voiceName) return;
      const cat = categorizeTtsVoice(v);
      if (cat === 'male' && !male) male = v.voiceName;
      if (cat === 'female' && !female) female = v.voiceName;
    });

    const english = voices.filter(
      v => (v.lang || '').toLowerCase().startsWith('en') && v.voiceName
    );
    if (!male && english[0]) male = english[0].voiceName;
    if (!female && english[1]) female = english[1].voiceName;

    if (!male && voices[0]?.voiceName) male = voices[0].voiceName;
    if (!female && voices[1]?.voiceName) female = voices[1].voiceName;

    resolvedVoices = { male, female };
  }

  function updateVoiceToggleUI() {
    if (!voiceToggle) return;
    if (currentSettings.gender === 'female') {
      voiceToggle.classList.add('is-female');
      voiceToggle.classList.remove('is-male');
    } else {
      voiceToggle.classList.add('is-male');
      voiceToggle.classList.remove('is-female');
    }
  }

  function populateVoicesAndInit() {
    if (!chrome.tts) {
      console.warn('chrome.tts not available in popup');
      return;
    }

    chrome.tts.getVoices(voices => {
      availableVoices = voices || [];
      if (availableVoices.length === 0) {
        console.warn('No TTS voices available');
        return;
      }

      resolveMaleFemaleVoices(availableVoices);

      const chosenVoiceName =
        currentSettings.gender === 'female' ? resolvedVoices.female : resolvedVoices.male;

      const viewableVoiceSettings = {
        voiceName: chosenVoiceName,
        volume: currentSettings.volume,
        rate: currentSettings.rate
      };

      chrome.storage.sync.set(
        {
          viewableVoiceSettings,
          viewableVoiceSettingsGender: currentSettings.gender
        },
        () => {
          updateVoiceToggleUI();
        }
      );
    });
  }

  chrome.storage.sync.get(['viewableVoiceSettingsGender', 'viewableVoiceSettings', 'viewableLanguage'], data => {
    if (data && typeof data.viewableVoiceSettingsGender === 'string') {
      currentSettings.gender = data.viewableVoiceSettingsGender === 'female' ? 'female' : 'male';
    }
    if (data && data.viewableVoiceSettings) {
      const vs = data.viewableVoiceSettings;
      if (typeof vs.volume === 'number') {
        currentSettings.volume = vs.volume;
      }
      if (typeof vs.rate === 'number') {
        currentSettings.rate = vs.rate;
      }
    }
    if (data && typeof data.viewableLanguage === 'string') {
      currentSettings.language = data.viewableLanguage;
      languageSelect.value = data.viewableLanguage;
    }
    voiceVolume.value = currentSettings.volume;
    voiceSpeed.value = currentSettings.rate;
    populateVoicesAndInit();
  });

  voiceToggle.addEventListener('click', () => {
    currentSettings.gender = currentSettings.gender === 'male' ? 'female' : 'male';
    updateVoiceToggleUI();

    const chosenVoiceName =
      currentSettings.gender === 'female' ? resolvedVoices.female : resolvedVoices.male;

    const viewableVoiceSettings = {
      voiceName: chosenVoiceName,
      volume: currentSettings.volume
    };

    chrome.storage.sync.set({
      viewableVoiceSettings,
      viewableVoiceSettingsGender: currentSettings.gender
    });
  });

  voiceVolume.addEventListener('input', () => {
    const v = parseFloat(voiceVolume.value);
    currentSettings.volume = Number.isNaN(v) ? 1 : Math.min(Math.max(v, 0), 1);

    chrome.storage.sync.get(['viewableVoiceSettings'], data => {
      const vs = data.viewableVoiceSettings || {};
      const newSettings = {
        voiceName:
          vs.voiceName ||
          (currentSettings.gender === 'female' ? resolvedVoices.female : resolvedVoices.male),
        volume: currentSettings.volume,
        rate: currentSettings.rate
      };
      chrome.storage.sync.set({ viewableVoiceSettings: newSettings });
    });
  });

  voiceSpeed.addEventListener('input', () => {
    const r = parseFloat(voiceSpeed.value);
    currentSettings.rate = Number.isNaN(r) ? 1 : Math.min(Math.max(r, 0.5), 2);

    chrome.storage.sync.get(['viewableVoiceSettings'], data => {
      const vs = data.viewableVoiceSettings || {};
      const newSettings = {
        voiceName:
          vs.voiceName ||
          (currentSettings.gender === 'female' ? resolvedVoices.female : resolvedVoices.male),
        volume: currentSettings.volume,
        rate: currentSettings.rate
      };
      chrome.storage.sync.set({ viewableVoiceSettings: newSettings });
    });
  });

  languageSelect.addEventListener('change', () => {
    currentSettings.language = languageSelect.value;
    chrome.storage.sync.set({ viewableLanguage: currentSettings.language });
  });

  btnReader.addEventListener('click', () => {
    sendToActiveTab({ type: 'VIEWABLE_SIMPLIFY' });
    window.close();
  });

  btnSummarize.addEventListener('click', () => {
    summarySection.hidden = false;
    summaryText.textContent = 'Summarizing...';

    console.log('Summarize button clicked');
    sendToActiveTab({ type: 'VIEWABLE_SUMMARIZE' }, res => {
      console.log('Got summary response:', res);
      if (res && res.summary) {
        summaryText.textContent = res.summary;
      } else {
        summaryText.textContent = 'Could not get summary for this page.';
      }
    });
  });

  btnDyslexic.addEventListener('click', () => {
    btnDyslexic.classList.toggle('is-on');
    sendToActiveTab({ type: 'VIEWABLE_DYSLEXIC_TOGGLE' });
  });

  btnContrast.addEventListener('click', () => {
    btnContrast.classList.toggle('is-on');
    sendToActiveTab({ type: 'VIEWABLE_CONTRAST_TOGGLE' });
  });

  btnIncrease.addEventListener('click', () => {
    sendToActiveTab({ type: 'VIEWABLE_TEXT_SIZE', action: 'INCREASE' });
  });

  btnDecrease.addEventListener('click', () => {
    sendToActiveTab({ type: 'VIEWABLE_TEXT_SIZE', action: 'DECREASE' });
  });

  btnReset.addEventListener('click', () => {
    sendToActiveTab({ type: 'VIEWABLE_TEXT_SIZE', action: 'RESET' });
  });

  btnReadAloud.addEventListener('click', () => {
    sendToActiveTab({ type: 'VIEWABLE_TOGGLE_READ_ALOUD' }, res => {
      if (res && res.speaking) {
        btnReadAloud.textContent = 'Stop reading';
      } else {
        btnReadAloud.textContent = 'Read aloud';
      }
    });
  });

  btnQuiz.addEventListener('click', () => {
    sendToActiveTab({ type: 'VIEWABLE_START_QUIZ' });
    window.close();
  });
});