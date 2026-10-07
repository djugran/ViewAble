let viewableIsSpeaking = false;
let currentAudio = null;

let viewableVoiceSettings = {
  voiceName: null,
  volume: 1,
  rate: 1
};

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || 'YOUR_ELEVENLABS_API_KEY_HERE';

chrome.storage.sync.get(['viewableVoiceSettings'], data => {
  if (data && data.viewableVoiceSettings) {
    viewableVoiceSettings = {
      voiceName: data.viewableVoiceSettings.voiceName ?? null,
      volume:
        typeof data.viewableVoiceSettings.volume === 'number'
          ? data.viewableVoiceSettings.volume
          : 1,
      rate:
        typeof data.viewableVoiceSettings.rate === 'number'
          ? data.viewableVoiceSettings.rate
          : 1
    };
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.viewableVoiceSettings) {
    const v = changes.viewableVoiceSettings.newValue;
    if (v) {
      viewableVoiceSettings = {
        voiceName: v.voiceName ?? null,
        volume: typeof v.volume === 'number' ? v.volume : 1,
        rate: typeof v.rate === 'number' ? v.rate : 1
      };
    }
  }
});

function stopTts() {
  viewableIsSpeaking = false;
  
  // Send message to content script to stop ElevenLabs audio
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'STOP_ELEVENLABS_AUDIO' });
    }
  });
  
  // Stop browser TTS
  try {
    chrome.tts.stop();
  } catch {}
}

async function speakWithElevenLabs(text, gender, tabId) {
  // ElevenLabs voice IDs - male and female voices
  const voiceId = gender === 'female' 
    ? 'EXAVITQu4vr4xnSDxMaL' // Rachel - natural female voice
    : 'pNInz6obpgDQGcFmaJgB'; // Adam - natural male voice
  
  try {
    // Only use first 200 characters to conserve credits
    const firstPart = text.slice(0, 200);
    
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text: firstPart,
        model_id: 'eleven_flash_v2_5',
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.5
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs error response:', errorText);
      throw new Error(`ElevenLabs HTTP ${response.status}`);
    }

    const audioBlob = await response.blob();
    const arrayBuffer = await audioBlob.arrayBuffer();
    
    // Convert to base64 without stack overflow
    const uint8Array = new Uint8Array(arrayBuffer);
    let binaryString = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binaryString += String.fromCharCode.apply(null, Array.from(chunk));
    }
    const base64Audio = btoa(binaryString);
    
    // Send audio to content script to play
    chrome.tabs.sendMessage(tabId, {
      type: 'PLAY_ELEVENLABS_AUDIO',
      audioData: base64Audio,
      volume: viewableVoiceSettings.volume,
      rate: viewableVoiceSettings.rate
    });
    
    viewableIsSpeaking = true;
    return { success: true, charsUsed: firstPart.length };
  } catch (error) {
    console.error('ElevenLabs TTS failed:', error);
    return { success: false, charsUsed: 0 };
  }
}

function speakWithBrowserTts(text) {
  if (!chrome.tts) return;

  const clean = (text || '').slice(0, 8000);
  if (!clean.trim()) return;

  chrome.storage.sync.get(['viewableVoiceSettings', 'viewableVoiceSettingsGender'], data => {
    const vs = data && data.viewableVoiceSettings ? data.viewableVoiceSettings : {};
    const volume = typeof vs.volume === 'number' ? vs.volume : viewableVoiceSettings.volume;
    const rate = typeof vs.rate === 'number' ? vs.rate : viewableVoiceSettings.rate;
    const voiceName = vs.voiceName ?? viewableVoiceSettings.voiceName;

    const opts = {
      rate: rate,
      volume: Math.min(Math.max(volume, 0), 1),
      pitch: 1.0,
      onEvent: ev => {
        if (['end', 'interrupted', 'error', 'cancelled'].includes(ev.type)) {
          viewableIsSpeaking = false;
        }
      }
    };

    if (voiceName) {
      opts.voiceName = voiceName;
    }

    stopTts();
    viewableIsSpeaking = true;
    chrome.tts.speak(clean, opts, () => {
      if (chrome.runtime.lastError) {
        console.error('TTS error:', chrome.runtime.lastError.message);
        viewableIsSpeaking = false;
      }
    });
  });
}

async function speakText(text, gender = 'male', tabId) {
  // Try ElevenLabs for first 200 chars (premium intro)
  const elevenLabsResult = await speakWithElevenLabs(text, gender, tabId);
  
  if (elevenLabsResult.success && text.length > elevenLabsResult.charsUsed) {
    // Wait for ElevenLabs audio to finish, then continue with browser TTS for the rest
    const remainingText = text.slice(elevenLabsResult.charsUsed);
    
    // Calculate estimated duration of ElevenLabs audio (rough estimate: 150 words/min, avg 5 chars/word)
    const estimatedDuration = (elevenLabsResult.charsUsed / 5) * (60 / 150) * 1000 / viewableVoiceSettings.rate;
    
    setTimeout(() => {
      if (viewableIsSpeaking) {
        speakWithBrowserTts(remainingText);
      }
    }, estimatedDuration);
  } else if (!elevenLabsResult.success) {
    // If ElevenLabs fails completely, use browser TTS for everything
    console.log('ElevenLabs failed, using browser TTS for full text');
    speakWithBrowserTts(text);
  }
}

const GROQ_API_KEY = process.env.GROQ_API_KEY || 'YOUR_GROQ_API_KEY_HERE';

function parseGroqQuizResponse(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error('Groq response was not valid JSON: ' + content.slice(0, 200));
  }

  if (!parsed || !Array.isArray(parsed.questions)) {
    throw new Error('Groq JSON missing questions array');
  }

  const questions = parsed.questions
    .filter(
      q =>
        q &&
        typeof q.question === 'string' &&
        Array.isArray(q.options) &&
        q.options.length === 4 &&
        typeof q.correctIndex === 'number'
    )
    .map(q => ({
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex
    }));

  if (questions.length === 0) {
    throw new Error('Groq returned no valid questions');
  }

  return questions;
}

async function generateQuizQuestionsFromText(text, language = 'English') {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    throw new Error('GROQ_API_KEY not set in background.js');
  }

  const trimmed = (text || '').slice(0, 8000);

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful tutor. Given the input text, generate exactly 5 multiple-choice questions (MCQs) that test understanding of the main ideas. ' +
            `Write all questions and answer options in ${language}. ` +
            'Return ONLY strict JSON with this exact shape: ' +
            '{ "questions": [ { "question": "string", "options": ["A","B","C","D"], "correctIndex": 0 } ] }. ' +
            'No extra commentary or formatting, just JSON.'
        },
        {
          role: 'user',
          content: trimmed
        }
      ],
      temperature: 0.4,
      max_tokens: 2000
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Groq HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  console.log('Quiz API response:', data);
  
  // Try content first, then reasoning field (for reasoning models)
  let rawContent = data.choices?.[0]?.message?.content || '';
  if (!rawContent && data.choices?.[0]?.message?.reasoning) {
    rawContent = data.choices?.[0]?.message?.reasoning || '';
  }
  
  console.log('Raw content for parsing:', rawContent.slice(0, 500));
  const questions = parseGroqQuizResponse(rawContent);
  return questions;
}

async function generateSummaryFromText(text, language = 'English') {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    throw new Error('GROQ_API_KEY not set in background.js');
  }

  const trimmed = (text || '').slice(0, 8000);

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-20b',
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful reading assistant. Given the text from a webpage, write a clear and concise summary in exactly 1-2 sentences. ' +
            `Write in ${language}. ` +
            'Do not use bullet points. Do not include any preamble like "Here is a summary" — just write the summary directly. ' +
            'Keep it brief and capture only the most important point.'
        },
        {
          role: 'user',
          content: trimmed
        }
      ],
      temperature: 0.3,
      max_tokens: 400
    })
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Groq API error:', resp.status, errText);
    throw new Error(`Groq HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  console.log('Groq API response:', data);
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  if (!raw) {
    console.error('Empty summary. Full response:', JSON.stringify(data));
    // Don't throw error, return empty so fallback can be used
    return '';
  }

  return raw;
}

async function translateText(text, language) {
  if (!GROQ_API_KEY || GROQ_API_KEY === 'YOUR_GROQ_API_KEY_HERE') {
    throw new Error('GROQ_API_KEY not set in background.js');
  }

  if (!language || language === 'English') return text;

  const trimmed = (text || '').slice(0, 8000);
  console.log('Starting translation to', language, 'text length:', trimmed.length);

  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [
        {
          role: 'system',
          content:
            `You are a professional translator. Translate the following text into ${language}. ` +
            'Preserve the structure: keep headings as headings and paragraphs as paragraphs, separated by blank lines. ' +
            'Output ONLY the translated text with no preamble, explanation, or commentary.'
        },
        {
          role: 'user',
          content: trimmed
        }
      ],
      temperature: 0.2,
      max_tokens: 4000
    })
  });

  console.log('Translation API status:', resp.status);

  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Translation API error response:', errText);
    throw new Error(`Groq HTTP ${resp.status}: ${errText}`);
  }

  const data = await resp.json();
  console.log('Translation API response:', data);
  
  // Try content first, then reasoning field (for reasoning models)
  let translated = data.choices?.[0]?.message?.content?.trim() || '';
  if (!translated && data.choices?.[0]?.message?.reasoning) {
    translated = data.choices?.[0]?.message?.reasoning?.trim() || '';
  }
  
  if (!translated) {
    console.error('Empty translation. Full response:', JSON.stringify(data));
    throw new Error('Groq returned empty translation');
  }
  console.log('Translation successful, returning length:', translated.length);
  return translated;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'VIEWABLE_AI_TRANSLATE') {
    (async () => {
      try {
        const langData = await new Promise(resolve =>
          chrome.storage.sync.get(['viewableLanguage'], resolve)
        );
        const language = (langData && langData.viewableLanguage) || 'English';
        console.log('Translating to:', language);
        const translated = await translateText(msg.text || '', language);
        console.log('Translation successful, length:', translated.length);
        sendResponse({ ok: true, translated, language });
      } catch (e) {
        console.error('Translation error', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'VIEWABLE_TTS_START') {
    (async () => {
      try {
        // Get tab ID from sender or query active tab
        let tabId = sender.tab?.id;
        
        if (!tabId) {
          // If no sender tab, get the active tab
          const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = tabs[0]?.id;
        }
        
        if (!tabId) {
          console.error('No tab ID available for TTS');
          sendResponse?.({ ok: false });
          return;
        }
        
        const genderData = await new Promise(resolve =>
          chrome.storage.sync.get(['viewableVoiceSettingsGender'], resolve)
        );
        const gender = (genderData && genderData.viewableVoiceSettingsGender) || 'male';
        await speakText(msg.text || '', gender, tabId);
        sendResponse?.({ ok: true });
      } catch (e) {
        console.error('TTS start error:', e);
        sendResponse?.({ ok: false });
      }
    })();
    return true;
  }

  if (msg.type === 'VIEWABLE_TTS_STOP') {
    stopTts();
    sendResponse?.({ ok: true });
    return true;
  }

  if (msg.type === 'VIEWABLE_TTS_STATUS') {
    sendResponse?.({ speaking: viewableIsSpeaking });
    return true;
  }

  if (msg.type === 'VIEWABLE_AI_SUMMARIZE') {
    (async () => {
      try {
        const text = msg.text || '';
        const langData = await new Promise(resolve =>
          chrome.storage.sync.get(['viewableLanguage'], resolve)
        );
        const language = (langData && langData.viewableLanguage) || 'English';
        const summary = await generateSummaryFromText(text, language);
        if (summary) {
          sendResponse({ ok: true, summary });
        } else {
          sendResponse({ ok: false, error: 'Empty summary' });
        }
      } catch (e) {
        console.error('Summary generation error', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg.type === 'VIEWABLE_AI_QUIZ') {
    (async () => {
      try {
        const text = msg.text || '';
        const langData = await new Promise(resolve =>
          chrome.storage.sync.get(['viewableLanguage'], resolve)
        );
        const language = (langData && langData.viewableLanguage) || 'English';
        const questions = await generateQuizQuestionsFromText(text, language);
        sendResponse({ ok: true, questions });
      } catch (e) {
        console.error('Quiz generation error', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  return false;
});