// ─── Google API Config ───
// To enable direct Google Docs export:
// 1. Go to https://console.cloud.google.com/
// 2. Create a project (or select one)
// 3. Enable "Google Drive API" (APIs & Services > Enable APIs)
// 4. Create OAuth 2.0 credentials (APIs & Services > Credentials > Create > OAuth client ID > Web application)
//    - Add http://localhost:3001 to "Authorized JavaScript origins"
// 5. Paste your Client ID below:
const GOOGLE_CLIENT_ID = localStorage.getItem('mwa-google-client-id') || '';

// ─── State ───
const state = {
  timerSeconds: 20 * 60,
  timerInterval: null,
  sprintActive: false,
  sprintStart: null,
  zenMode: false,
  lastSavedText: '',
  aiEnabled: false,
  geminiEnabled: false,
  claudeEnabled: false,
  preferLocal: localStorage.getItem('mwa-prefer-local') === 'true',
  googleAccessToken: null,
};

// ─── Elements ───
const $ = (sel) => document.querySelector(sel);
const writingArea = $('#writing-area');
const wordCount = $('#word-count');
const timerDisplay = $('#timer-display');
const lastParagraphContent = $('#last-paragraph-content');
const feedbackPanel = $('#feedback-panel');
const feedbackContent = $('#feedback-content');
const vibeNotification = $('#vibe-notification');
const loadingOverlay = $('#loading-overlay');
const sprintGoalInput = $('#sprint-goal');
const sprintProgress = $('#sprint-progress');
const sprintProgressFill = $('#sprint-progress-fill');

// ─── AI Status Badge ───
// provider: 'gemini' | 'claude' | 'local' | 'checking' | 'offline'
function setStatusBadge(provider) {
  const badge = $('#ai-status-badge');
  if (!badge) return;

  const modes = {
    checking: { text: '⋯ Checking', title: 'Checking AI availability…' },
    gemini:   { text: '✨ AI · Gemini', title: 'Powered by Google Gemini' },
    claude:   { text: '\u{1F9E0} AI · Claude', title: 'Powered by Anthropic Claude (fallback)' },
    local:    { text: '\u{1F9D8} Local Mode', title: 'Using the built-in local writing coach — no AI call was made' },
    offline:  { text: '\u{1F9D8} Local Mode', title: 'No AI provider configured — using the built-in local writing coach' },
  };

  const mode = modes[provider] || modes.offline;
  badge.textContent = mode.text;
  badge.title = mode.title;
  badge.className = `status-badge status-${provider in modes ? provider : 'offline'}`;
}

function updateToggleAvailability() {
  const toggleLabel = $('#ai-toggle-label');
  const toggle = $('#ai-toggle');
  if (!toggleLabel || !toggle) return;
  const anyAiConfigured = state.geminiEnabled || state.claudeEnabled;
  toggleLabel.classList.toggle('toggle-disabled', !anyAiConfigured);
  toggle.disabled = !anyAiConfigured;
  toggle.checked = state.preferLocal;
  toggleLabel.title = anyAiConfigured
    ? 'Force local mode — no AI calls will be made'
    : 'No AI provider is configured, so the app is already running locally';
}

// ─── Initialize ───
function init() {
  // Check AI status
  setStatusBadge('checking');
  fetch('/api/status').then(r => r.json()).then(d => {
    state.aiEnabled = d.aiEnabled;
    state.geminiEnabled = !!d.geminiEnabled;
    state.claudeEnabled = !!d.claudeEnabled;
    updateToggleAvailability();

    if (state.preferLocal) {
      setStatusBadge('local');
    } else if (state.geminiEnabled) {
      setStatusBadge('gemini');
    } else if (state.claudeEnabled) {
      setStatusBadge('claude');
    } else {
      setStatusBadge('offline');
    }
  }).catch(() => setStatusBadge('offline'));

  $('#ai-toggle').addEventListener('change', (e) => {
    state.preferLocal = e.target.checked;
    localStorage.setItem('mwa-prefer-local', state.preferLocal);
    if (state.preferLocal) {
      setStatusBadge('local');
    } else if (state.geminiEnabled) {
      setStatusBadge('gemini');
    } else if (state.claudeEnabled) {
      setStatusBadge('claude');
    } else {
      setStatusBadge('offline');
    }
  });

  // Restore saved session
  const saved = localStorage.getItem('mwa-text');
  if (saved) {
    writingArea.value = saved;
    updateWordCount();
    updateLastParagraph();
  }

  const savedGoal = localStorage.getItem('mwa-sprint-goal');
  if (savedGoal) sprintGoalInput.value = savedGoal;

  // Show welcome back message if returning
  const lastSession = localStorage.getItem('mwa-last-session');
  if (lastSession && saved && saved.trim().length > 0) {
    const lastDate = new Date(lastSession);
    const now = new Date();
    const diffHours = (now - lastDate) / (1000 * 60 * 60);
    if (diffHours > 1) {
      const words = saved.trim().split(/\s+/).length;
      const dateStr = lastDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      showWelcomeBack(dateStr, words, savedGoal);
    }
  }
  localStorage.setItem('mwa-last-session', new Date().toISOString());

  // Event listeners
  writingArea.addEventListener('input', onTextInput);
  $('#zen-toggle').addEventListener('click', toggleZenMode);
  $('#start-sprint').addEventListener('click', startSprint);
  $('#stop-sprint').addEventListener('click', stopSprint);
  $('#do-vibe-check').addEventListener('click', doVibeCheck);
  $('#skip-vibe').addEventListener('click', skipVibe);
  $('#close-feedback').addEventListener('click', closeFeedback);
  $('#btn-vibe-now').addEventListener('click', doVibeCheck);
  $('#btn-show-tell').addEventListener('click', doShowDontTell);
  $('#btn-save').addEventListener('click', saveText);
  $('#btn-export').addEventListener('click', toggleExportMenu);
  $('#btn-export-docx').addEventListener('click', () => { closeExportMenu(); exportDocx(); });
  $('#btn-export-gdoc').addEventListener('click', () => { closeExportMenu(); exportGoogleDoc(); });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.export-dropdown')) closeExportMenu();
  });

  // Auto-save every 15 seconds
  setInterval(() => {
    localStorage.setItem('mwa-text', writingArea.value);
    localStorage.setItem('mwa-sprint-goal', sprintGoalInput.value);
    localStorage.setItem('mwa-last-session', new Date().toISOString());
  }, 15000);

  // Save on page close
  window.addEventListener('beforeunload', () => {
    localStorage.setItem('mwa-text', writingArea.value);
    localStorage.setItem('mwa-sprint-goal', sprintGoalInput.value);
    localStorage.setItem('mwa-last-session', new Date().toISOString());
  });
}

// ─── Text Input Handler ───
function onTextInput() {
  updateWordCount();
  updateLastParagraph();
}

function updateWordCount() {
  const text = writingArea.value.trim();
  const count = text ? text.split(/\s+/).length : 0;
  wordCount.textContent = `${count} word${count !== 1 ? 's' : ''}`;
}

function updateLastParagraph() {
  const text = writingArea.value.trim();
  if (!text) {
    lastParagraphContent.innerHTML = '<p class="placeholder-text">Your most recent paragraph will appear here as you write, so you always know where you left off.</p>';
    return;
  }

  const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim());
  if (paragraphs.length > 0) {
    const last = paragraphs[paragraphs.length - 1].trim();
    lastParagraphContent.innerHTML = `<p>${escapeHtml(last)}</p>`;
  }
}

// ─── Timer ───
function startTimer() {
  state.timerSeconds = 20 * 60;
  updateTimerDisplay();

  if (state.timerInterval) clearInterval(state.timerInterval);

  state.timerInterval = setInterval(() => {
    state.timerSeconds--;
    updateTimerDisplay();

    if (state.timerSeconds <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      triggerVibeCheck();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const mins = Math.floor(state.timerSeconds / 60);
  const secs = state.timerSeconds % 60;
  timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;

  // Color shift as time runs low
  if (state.timerSeconds <= 60) {
    timerDisplay.style.color = 'var(--accent-soft)';
  } else if (state.timerSeconds <= 5 * 60) {
    timerDisplay.style.color = 'var(--gold)';
  } else {
    timerDisplay.style.color = 'var(--green)';
  }
}

function triggerVibeCheck() {
  vibeNotification.classList.remove('hidden');
}

function skipVibe() {
  vibeNotification.classList.add('hidden');
  startTimer();
}

// ─── Sprint ───
function startSprint() {
  state.sprintActive = true;
  state.sprintStart = Date.now();

  $('#start-sprint').classList.add('hidden');
  $('#stop-sprint').classList.remove('hidden');
  sprintProgress.classList.remove('hidden');
  sprintGoalInput.readOnly = true;

  startTimer();
  updateSprintProgress();
}

function stopSprint() {
  state.sprintActive = false;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  $('#start-sprint').classList.remove('hidden');
  $('#stop-sprint').classList.add('hidden');
  sprintProgress.classList.add('hidden');
  sprintGoalInput.readOnly = false;

  state.timerSeconds = 20 * 60;
  updateTimerDisplay();
  timerDisplay.style.color = 'var(--gold)';
}

function updateSprintProgress() {
  if (!state.sprintActive) return;

  const elapsed = Date.now() - state.sprintStart;
  const total = 20 * 60 * 1000;
  const pct = Math.min((elapsed / total) * 100, 100);
  sprintProgressFill.style.width = `${pct}%`;

  requestAnimationFrame(updateSprintProgress);
}

// ─── Zen Mode ───
function toggleZenMode() {
  state.zenMode = !state.zenMode;
  document.body.classList.toggle('zen-mode', state.zenMode);
  $('#zen-toggle').classList.toggle('active', state.zenMode);
  writingArea.focus();
}

// ─── API Calls ───
async function doVibeCheck() {
  vibeNotification.classList.add('hidden');

  const text = writingArea.value.trim();
  if (text.length < 20) {
    showTemporaryFeedback('Write a bit more first — at least a couple of sentences!');
    startTimer();
    return;
  }

  // Send last ~2000 chars for context
  const recentText = text.slice(-2000);
  showLoading(true);

  try {
    const res = await fetch('/api/vibe-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: recentText,
        sprintGoal: sprintGoalInput.value.trim(),
        preferLocal: state.preferLocal
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Vibe check failed');
    }

    const data = await res.json();
    setStatusBadge(data.provider || 'local');
    showVibeCheckResults(data);
  } catch (err) {
    showTemporaryFeedback(err.message || 'Something went wrong. Keep writing!');
  } finally {
    showLoading(false);
    startTimer();
  }
}

async function doShowDontTell() {
  const text = writingArea.value.trim();
  if (text.length < 20) {
    showTemporaryFeedback('Write a bit more first — need at least a couple of sentences to analyze!');
    return;
  }

  // Analyze last ~2000 chars
  const recentText = text.slice(-2000);
  showLoading(true);

  try {
    const res = await fetch('/api/show-dont-tell', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: recentText, preferLocal: state.preferLocal })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Analysis failed');
    }

    const data = await res.json();
    setStatusBadge(data.provider || 'local');
    showShowDontTellResults(data);
  } catch (err) {
    showTemporaryFeedback(err.message || 'Analysis failed. Keep writing!');
  } finally {
    showLoading(false);
  }
}

// ─── Render Results ───
function showVibeCheckResults(data) {
  let html = '';

  // Vibe Summary
  html += `
    <div class="feedback-section">
      <h4>&#127756; Vibe Summary</h4>
      <div class="vibe-summary">
        <p>${escapeHtml(data.vibeSummary)}</p>
      </div>
    </div>`;

  // Next Sentences
  html += `
    <div class="feedback-section">
      <h4>&#9997;&#65039; Next Sentence Options</h4>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-bottom:10px;">Click one to add it to your writing</p>`;

  data.nextSentences.forEach(sentence => {
    const labelMatch = sentence.match(/^([A-C]):\s*/);
    const label = labelMatch ? labelMatch[1] : '';
    const text = labelMatch ? sentence.slice(labelMatch[0].length) : sentence;

    html += `
      <div class="next-sentence-option" onclick="insertSentence(this)" data-text="${escapeAttr(text)}">
        ${label ? `<span class="option-label">Option ${label}</span>` : ''}
        ${escapeHtml(text)}
      </div>`;
  });

  html += `</div>`;

  // Momentum Nudge
  html += `
    <div class="feedback-section">
      <div class="momentum-nudge">${escapeHtml(data.momentumNudge)}</div>
    </div>`;

  feedbackContent.innerHTML = html;
  feedbackPanel.classList.remove('hidden');
}

function showShowDontTellResults(data) {
  let html = '';

  // Score
  const scoreLabel = {
    mostly_showing: 'Mostly Showing',
    balanced: 'Balanced',
    mostly_telling: 'Mostly Telling'
  };

  html += `
    <div class="feedback-section">
      <h4>&#128065; Show Don't Tell Analysis</h4>
      <span class="score-badge score-${data.overallScore}">
        ${scoreLabel[data.overallScore] || data.overallScore}
      </span>
    </div>`;

  // Tell instances
  if (data.tellInstances && data.tellInstances.length > 0) {
    html += `
      <div class="feedback-section">
        <h4>&#128270; Telling Phrases Found</h4>`;

    data.tellInstances.forEach(inst => {
      html += `
        <div class="tell-instance">
          <div class="tell-original">"${escapeHtml(inst.original)}"</div>
          <div class="tell-issue">${escapeHtml(inst.issue)}</div>
          <div class="tell-alternative" onclick="replaceText(this)"
               data-original="${escapeAttr(inst.original)}"
               data-replacement="${escapeAttr(inst.showAlternative)}">
            ${escapeHtml(inst.showAlternative)}
          </div>
        </div>`;
    });

    html += `</div>`;
  }

  // Praise
  if (data.praise) {
    html += `
      <div class="feedback-section">
        <h4>&#11088; What's Working</h4>
        <div class="praise-box">${escapeHtml(data.praise)}</div>
      </div>`;
  }

  feedbackContent.innerHTML = html;
  feedbackPanel.classList.remove('hidden');
}

// ─── Actions ───
window.insertSentence = function(el) {
  const text = el.dataset.text;
  const current = writingArea.value;
  const needsSpace = current && !current.endsWith(' ') && !current.endsWith('\n');
  writingArea.value = current + (needsSpace ? ' ' : '') + text;
  writingArea.focus();
  writingArea.scrollTop = writingArea.scrollHeight;
  onTextInput();
};

window.replaceText = function(el) {
  const original = el.dataset.original;
  const replacement = el.dataset.replacement;
  const text = writingArea.value;
  const idx = text.lastIndexOf(original);
  if (idx !== -1) {
    writingArea.value = text.substring(0, idx) + replacement + text.substring(idx + original.length);
    onTextInput();
  }
  // Visual feedback
  el.style.borderColor = 'var(--green)';
  el.innerHTML = '&#10003; Replaced! ' + escapeHtml(replacement);
};

function closeFeedback() {
  feedbackPanel.classList.add('hidden');
  writingArea.focus();
}

function showTemporaryFeedback(message) {
  feedbackContent.innerHTML = `
    <div class="feedback-section" style="padding-top:40px;text-align:center;">
      <p style="font-family:var(--font-serif);font-size:1rem;color:var(--text-secondary);">${escapeHtml(message)}</p>
    </div>`;
  feedbackPanel.classList.remove('hidden');
  setTimeout(() => {
    if (feedbackPanel.querySelector('.feedback-section')) {
      closeFeedback();
    }
  }, 3000);
}

function showLoading(show) {
  loadingOverlay.classList.toggle('hidden', !show);
}

// ─── Save / Export ───
function saveText() {
  localStorage.setItem('mwa-text', writingArea.value);
  localStorage.setItem('mwa-sprint-goal', sprintGoalInput.value);

  const btn = $('#btn-save');
  const orig = btn.innerHTML;
  btn.innerHTML = '&#10003; Saved!';
  btn.style.borderColor = 'var(--green)';
  btn.style.color = 'var(--green)';
  setTimeout(() => {
    btn.innerHTML = orig;
    btn.style.borderColor = '';
    btn.style.color = '';
  }, 2000);
}

async function exportDocx() {
  const text = writingArea.value;
  if (!text.trim()) return;

  const btn = $('#btn-export-docx');
  const orig = btn.innerHTML;
  btn.innerHTML = '&#9203; Exporting...';
  btn.disabled = true;

  try {
    const res = await fetch('/api/export-docx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        title: sprintGoalInput.value.trim() || 'My Writing'
      })
    });

    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = disposition.match(/filename="(.+)"/);
    a.download = match ? match[1] : `writing-${new Date().toISOString().slice(0, 10)}.docx`;
    a.click();
    URL.revokeObjectURL(url);

    btn.innerHTML = '&#10003; Downloaded!';
    btn.style.borderColor = 'var(--green)';
    btn.style.color = 'var(--green)';
  } catch (err) {
    btn.innerHTML = '&#10007; Failed';
    btn.style.borderColor = 'var(--accent)';
    btn.style.color = 'var(--accent)';
  } finally {
    setTimeout(() => {
      btn.innerHTML = orig;
      btn.style.borderColor = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2000);
  }
}

// ─── Welcome Back ───
function showWelcomeBack(dateStr, wordCount, goal) {
  feedbackContent.innerHTML = `
    <div class="feedback-section" style="padding-top:30px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:12px;">&#9995;</div>
      <h4 style="color:var(--green);margin-bottom:8px;font-size:1rem;">Welcome back!</h4>
      <p style="color:var(--text-secondary);font-size:0.85rem;margin-bottom:16px;">
        Last session: <strong>${dateStr}</strong>
      </p>
      <div style="padding:12px 16px;background:rgba(78,205,196,0.08);border-radius:8px;margin-bottom:16px;">
        <p style="font-size:0.85rem;color:var(--text-secondary);">
          You have <strong style="color:var(--gold);">${wordCount} words</strong> saved
          ${goal ? `<br>Sprint goal: <em>"${escapeHtml(goal)}"</em>` : ''}
        </p>
      </div>
      <p style="font-family:var(--font-serif);font-style:italic;color:var(--text-muted);font-size:0.85rem;">
        Your writing is right where you left it. Ready to continue?
      </p>
      <button onclick="document.getElementById('feedback-panel').classList.add('hidden');document.getElementById('writing-area').focus();"
              style="margin-top:16px;padding:10px 24px;background:var(--green);color:var(--bg-deep);border:none;
                     border-radius:8px;font-weight:600;cursor:pointer;font-size:0.85rem;">
        Let's Write
      </button>
    </div>`;
  feedbackPanel.classList.remove('hidden');
}

// ─── Export Menu ───
function toggleExportMenu() {
  $('#export-menu').classList.toggle('hidden');
}

function closeExportMenu() {
  $('#export-menu').classList.add('hidden');
}

function exportGoogleDoc() {
  const text = writingArea.value;
  if (!text.trim()) return;

  const clientId = GOOGLE_CLIENT_ID;

  // If no client ID configured, show setup instructions
  if (!clientId) {
    showGoogleSetupInstructions();
    return;
  }

  // Request Google auth token
  const tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: 'https://www.googleapis.com/auth/drive.file',
    callback: async (tokenResponse) => {
      if (tokenResponse.error) {
        showTemporaryFeedback('Google sign-in was cancelled or failed.');
        return;
      }
      state.googleAccessToken = tokenResponse.access_token;
      await uploadToGoogleDrive(text);
    },
  });

  // If we already have a token, try using it; otherwise prompt
  if (state.googleAccessToken) {
    uploadToGoogleDrive(text);
  } else {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  }
}

async function uploadToGoogleDrive(text) {
  showLoading(true);
  const title = sprintGoalInput.value.trim() || 'My Writing';
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Build HTML content that Google Docs will render nicely
  const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body>
<h1 style="text-align:center;font-family:Georgia,serif;">${escapeHtml(title)}</h1>
<p style="text-align:center;color:#888;font-style:italic;">${dateStr}</p>
<hr>
${text.split(/\n\s*\n/).filter(p => p.trim()).map(p =>
    `<p style="font-family:Georgia,serif;font-size:12pt;line-height:1.8;">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`
  ).join('\n')}
</body></html>`;

  // Use multipart upload to create a Google Doc
  const metadata = {
    name: `${title} - ${new Date().toISOString().slice(0, 10)}`,
    mimeType: 'application/vnd.google-apps.document',
  };

  const boundary = '---mindful-writing-boundary';
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n\r\n` +
    `${htmlBody}\r\n` +
    `--${boundary}--`;

  try {
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${state.googleAccessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: body,
    });

    if (res.status === 401) {
      // Token expired, clear and retry
      state.googleAccessToken = null;
      showLoading(false);
      exportGoogleDoc();
      return;
    }

    if (!res.ok) throw new Error('Upload failed');

    const data = await res.json();
    const docUrl = `https://docs.google.com/document/d/${data.id}/edit`;

    showLoading(false);

    // Show success with link to open the doc
    feedbackContent.innerHTML = `
      <div class="feedback-section" style="padding-top:40px;text-align:center;">
        <div style="font-size:3rem;margin-bottom:16px;">&#10003;</div>
        <h4 style="color:var(--green);margin-bottom:12px;">Exported to Google Docs!</h4>
        <p style="margin-bottom:20px;color:var(--text-secondary);">Your writing is now a Google Doc in your Drive.</p>
        <a href="${docUrl}" target="_blank" rel="noopener"
           style="display:inline-block;padding:12px 28px;background:var(--green);color:var(--bg-deep);
                  border-radius:10px;text-decoration:none;font-weight:600;font-size:0.9rem;">
          Open in Google Docs
        </a>
        <p style="margin-top:16px;font-size:0.75rem;color:var(--text-muted);">
          "${escapeHtml(metadata.name)}"
        </p>
      </div>`;
    feedbackPanel.classList.remove('hidden');

  } catch (err) {
    showLoading(false);
    showTemporaryFeedback('Google Drive export failed. Please try again.');
    console.error('Google Drive upload error:', err);
  }
}

function showGoogleSetupInstructions() {
  feedbackContent.innerHTML = `
    <div class="feedback-section" style="padding-top:20px;">
      <h4>&#128196; Set Up Google Docs Export</h4>
      <p style="margin-bottom:16px;color:var(--text-secondary);font-size:0.85rem;">
        One-time setup to connect your Google Drive (takes ~3 minutes):
      </p>
      <ol style="font-size:0.83rem;color:var(--text-secondary);line-height:2.2;padding-left:20px;">
        <li>Go to <a href="https://console.cloud.google.com/" target="_blank" style="color:var(--green);">Google Cloud Console</a></li>
        <li>Create a new project (any name)</li>
        <li>Go to <strong>APIs & Services</strong> &rarr; <strong>Enable APIs</strong> &rarr; search & enable <strong>Google Drive API</strong></li>
        <li>Go to <strong>APIs & Services</strong> &rarr; <strong>OAuth consent screen</strong> &rarr; set up as <strong>External</strong>, fill in app name, your email, and save</li>
        <li>Go to <strong>Credentials</strong> &rarr; <strong>Create Credentials</strong> &rarr; <strong>OAuth client ID</strong></li>
        <li>Choose <strong>Web application</strong></li>
        <li>Under <strong>Authorized JavaScript origins</strong>, add:<br>
          <code style="background:rgba(0,0,0,0.3);padding:2px 8px;border-radius:4px;color:var(--gold);">http://localhost:3001</code></li>
        <li>Copy the <strong>Client ID</strong> and paste it below</li>
      </ol>
      <div style="margin-top:16px;">
        <input type="text" id="google-client-id-input"
               placeholder="Paste your Google Client ID here..."
               style="width:100%;padding:10px 14px;background:rgba(0,0,0,0.3);border:1px solid var(--border);
                      border-radius:8px;color:var(--text-primary);font-size:0.85rem;font-family:var(--font-sans);outline:none;">
        <button onclick="saveGoogleClientId()" style="margin-top:10px;width:100%;padding:10px;
                background:var(--green);color:var(--bg-deep);border:none;border-radius:8px;
                font-weight:600;cursor:pointer;font-size:0.85rem;">
          Save & Connect Google Drive
        </button>
      </div>
    </div>`;
  feedbackPanel.classList.remove('hidden');
}

window.saveGoogleClientId = function() {
  const input = document.getElementById('google-client-id-input');
  const clientId = input.value.trim();
  if (!clientId) return;

  localStorage.setItem('mwa-google-client-id', clientId);
  // Reload to pick up the new client ID
  window.location.reload();
};

// ─── Utilities ───
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── Start ───
init();
