const testStepCopy = (() => {
  const $ = (id) => document.getElementById(id);
  const dialog = $('tcCopyDialog');
  const mode = $('tcCopyMode');
  const editor = $('tcCopyEditor');
  const copy = $('tcCopyCurrent');
  const reset = $('tcCopyReset');
  const rewrite = $('tcCopyRewrite');
  const close = $('tcCopyClose');
  let session;
  let request;
  let rowCopyAttempt = 0;
  let rowFeedbackTimer;
  const previousRequestMessage = 'The previous Copilot request is still finishing…';
  const copyError = 'Could not copy. Check clipboard access and try again.';

  function status(text = '', error = false) {
    $('tcCopyStatus').textContent = text;
    $('tcCopyStatus').classList.toggle('tc-error', error);
  }

  function controls() {
    mode.options[1].disabled = !session.generated.ai;
    rewrite.disabled = Boolean(request || session.generated.ai || session.incomplete);
    reset.disabled = editor.value === session.generated[mode.value];
    $('tcCopyProgress').hidden = !request;
  }

  function display(version) {
    mode.value = version;
    editor.value = session.draft[version];
    editor.scrollTop = 0;
    controls();
  }

  function open(steps, trigger, warning) {
    if (dialog.open) return;
    const original = testStepMarkdown.table(steps);
    session = { steps, trigger, generated: { original }, draft: { original }, incomplete: Boolean(warning) };
    $('tcCopyCount').textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
    $('tcCopyWarning').textContent = warning ? warning + ' AI-modification requires a complete procedure.' : '';
    $('tcCopyWarning').hidden = !warning;
    status(request ? previousRequestMessage : '');
    display('original');
    dialog.showModal();
    editor.focus();
  }

  dialog.addEventListener('cancel', (event) => event.preventDefault());
  dialog.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === close) {
      event.preventDefault();
      copy.focus();
    } else if (!event.shiftKey && document.activeElement === copy) {
      event.preventDefault();
      close.focus();
    }
  });

  close.addEventListener('click', () => {
    const previous = session;
    session = null;
    dialog.close();
    previous.trigger.focus();
  });

  mode.addEventListener('change', () => {
    display(mode.value);
    status();
  });
  editor.addEventListener('input', () => {
    session.draft[mode.value] = editor.value;
    controls();
  });
  reset.addEventListener('click', () => {
    const version = mode.value;
    if (!window.confirm('Discard your edits to this version and restore the generated text?')) return;
    session.draft[version] = session.generated[version];
    display(version);
    status('Generated text restored.');
    editor.focus();
  });

  copy.addEventListener('click', async () => {
    const current = session;
    try {
      await copyTextToClipboard(editor.value, dialog);
      if (current === session) status('Copied to clipboard.');
    } catch {
      if (current === session) status(copyError, true);
    }
  });

  rewrite.addEventListener('click', async () => {
    const current = session;
    if (request || current.generated.ai || current.incomplete) return;
    const model = $('chatModel').value;
    if (!model) {
      status('Connect to Copilot in Setup and select a Copilot model, then try again.', true);
      return;
    }
    const controller = new AbortController();
    request = controller;
    if (document.activeElement === rewrite) editor.focus();
    controls();
    status('Copilot is rewriting the source steps…');
    const timeout = setTimeout(() => controller.abort(), 135_000);
    try {
      const data = await api('/api/chat/rewrite-test-steps', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ model, steps: current.steps }),
      });
      if (current !== session) return;
      if (!testStepMarkdown.validRewrite(data.steps, current.steps)) {
        throw new Error('The backend returned invalid rewritten steps. Please try again.');
      }
      const markdown = testStepMarkdown.table(data.steps);
      current.generated.ai = current.draft.ai = markdown;
      display('ai');
      status('AI-modified steps are ready.');
    } catch (error) {
      if (current !== session) return;
      status(controller.signal.aborted ? 'Copilot request timed out. Please try again.'
        : error instanceof TypeError ? 'Could not reach the app backend. Please try again.' : error.message, true);
    } finally {
      clearTimeout(timeout);
      request = null;
      if (session) {
        controls();
        if (current !== session && $('tcCopyStatus').textContent === previousRequestMessage) status();
      }
    }
  });

  function buttonFor(step, feedback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tc-step-copy';
    button.setAttribute('aria-label', `Copy step ${step.step}`);
    button.title = `Copy step ${step.step}`;
    button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const attempt = ++rowCopyAttempt;
      clearTimeout(rowFeedbackTimer);
      feedback('');
      try {
        await copyTextToClipboard(testStepMarkdown.table([step]));
        if (attempt === rowCopyAttempt) {
          feedback(`Step ${step.step} copied.`);
          rowFeedbackTimer = setTimeout(() => feedback(''), 3500);
        }
      } catch {
        if (attempt === rowCopyAttempt) feedback(copyError, true);
      }
    });
    return button;
  }

  return { open, buttonFor };
})();
