const testStepCopy = (() => {
  const $ = (id) => document.getElementById(id);
  const dialog = $('tcStepCopyDialog');
  const editor = $('tcStepCopyText');
  const close = $('tcStepCopyClose');
  const original = $('tcStepCopyOriginal');
  const aiMode = $('tcStepCopyAiMode');
  const generate = $('tcStepCopyGenerate');
  const copy = $('tcStepCopyClipboard');
  const reset = $('tcStepCopyReset');
  const status = $('tcStepCopyStatus');
  let current;
  let pending;
  let rowCopyAttempt = 0;
  let rowCopyTimer;
  const pendingMessage = 'The previous Copilot request is still finishing…';
  const clipboardError = 'Could not copy. Allow clipboard access or open the app on localhost/HTTPS and try again.';

  function report(target, value, error = false) {
    target.textContent = value;
    target.classList.toggle('tc-error', error);
  }

  function rowButton(step, feedback) {
    const button = $('tcStepCopyIcon').content.firstElementChild.cloneNode(true);
    button.setAttribute('aria-label', 'Copy step ' + step.step);
    button.title = 'Copy step ' + step.step;
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const attempt = ++rowCopyAttempt;
      clearTimeout(rowCopyTimer);
      feedback.textContent = '';
      try {
        await copyPlainText(testStepMarkdown.table([step]));
        if (attempt === rowCopyAttempt) {
          report(feedback, 'Step ' + step.step + ' copied.');
          rowCopyTimer = setTimeout(() => { feedback.textContent = ''; }, 3500);
        }
      } catch {
        if (attempt === rowCopyAttempt) report(feedback, clipboardError, true);
      }
    });
    return button;
  }

  function version() {
    return current[current.mode];
  }

  function controls() {
    original.setAttribute('aria-pressed', String(current.mode === 'original'));
    aiMode.setAttribute('aria-pressed', String(current.mode === 'ai'));
    aiMode.disabled = !current.ai;
    generate.setAttribute('aria-disabled', String(Boolean(pending || current.ai || current.incomplete)));
    $('tcStepCopyProgress').hidden = !pending;
    reset.disabled = version().draft === version().generated;
  }

  function showMode(mode) {
    current.mode = mode;
    editor.value = version().draft;
    editor.scrollTop = 0;
    editor.setSelectionRange(0, 0);
    controls();
  }

  function open(origin, steps, incomplete) {
    if (dialog.open) return;
    const generated = testStepMarkdown.table(steps);
    current = { origin, steps, incomplete, original: { generated, draft: generated } };
    $('tcStepCopyCount').textContent = steps.length + (steps.length === 1 ? ' step' : ' steps');
    $('tcStepCopyWarning').hidden = !incomplete;
    report(status, pending ? pendingMessage : '');
    showMode('original');
    dialog.showModal();
    editor.focus();
  }

  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not(:disabled), textarea')];
    const boundary = event.shiftKey ? focusable[0] : focusable.at(-1);
    if (document.activeElement !== boundary) return;
    event.preventDefault();
    (event.shiftKey ? focusable.at(-1) : focusable[0]).focus();
  });
  close.addEventListener('click', () => {
    const origin = current.origin;
    current = null;
    dialog.close();
    origin.focus();
  });
  original.addEventListener('click', () => showMode('original'));
  aiMode.addEventListener('click', () => { if (current.ai) showMode('ai'); });
  editor.addEventListener('input', () => {
    version().draft = editor.value;
    controls();
  });

  reset.addEventListener('click', () => {
    const currentVersion = version();
    if (currentVersion.draft === currentVersion.generated
        || !window.confirm('Restore the generated text for this version and discard its edits?')) return;
    currentVersion.draft = currentVersion.generated;
    showMode(current.mode);
    editor.focus();
    report(status, 'Generated text restored.');
  });

  copy.addEventListener('click', async () => {
    const snapshot = current;
    try {
      await copyPlainText(editor.value, dialog);
      if (current === snapshot) report(status, 'Copied to the clipboard.');
    } catch {
      if (current === snapshot) report(status, clipboardError, true);
    }
  });

  generate.addEventListener('click', async () => {
    const snapshot = current;
    if (pending || snapshot.ai || snapshot.incomplete) return;
    const model = $('chatModel').value;
    if (!model) {
      report(status, 'Connect to Copilot in Setup and select a Copilot model, then try again.', true);
      return;
    }
    pending = snapshot;
    controls();
    report(status, 'Preparing test steps with Copilot…');
    try {
      const result = await api('/api/chat/test-steps/rewrite', {
        method: 'POST', body: JSON.stringify({ model, steps: snapshot.steps }),
      });
      if (snapshot !== current) return;
      if (!testStepMarkdown.validRewrite(result.steps, snapshot.steps)) {
        throw new Error('Copilot returned invalid test steps. Try AI-modification again.');
      }
      const generated = testStepMarkdown.table(result.steps);
      snapshot.ai = { generated, draft: generated };
      showMode('ai');
      if (document.activeElement === generate) editor.focus();
      report(status, 'AI-modified steps are ready for review.');
    } catch (error) {
      if (snapshot === current) report(status, error.message || 'Could not reach Copilot. Try AI-modification again.', true);
    } finally {
      pending = null;
      if (current) {
        controls();
        if (snapshot !== current && status.textContent === pendingMessage) report(status, '');
      }
    }
  });

  return { open, rowButton };
})();
