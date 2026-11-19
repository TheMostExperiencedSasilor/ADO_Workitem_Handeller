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
  const copyError = 'Could not copy. Check clipboard access and try again.';

  function status(text = '', error = false) {
    $('tcCopyStatus').textContent = text;
    $('tcCopyStatus').classList.toggle('tc-error', error);
  }

  function controls() {
    mode.options[1].disabled = !session.generated.ai;
    rewrite.disabled = Boolean(session.request || session.generated.ai);
    reset.disabled = editor.value === session.generated[mode.value];
    $('tcCopyProgress').hidden = !session.request;
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
    session = { steps, trigger, generated: { original }, draft: { original }, request: null };
    $('tcCopyCount').textContent = `${steps.length} step${steps.length === 1 ? '' : 's'}`;
    $('tcCopyWarning').textContent = warning || '';
    $('tcCopyWarning').hidden = !warning;
    status();
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
    previous.request?.abort();
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
    if (current.request || current.generated.ai) return;
    const controller = new AbortController();
    current.request = controller;
    if (document.activeElement === rewrite) editor.focus();
    controls();
    status('Copilot is rewriting the source steps…');
    const timeout = setTimeout(() => controller.abort(), 135_000);
    try {
      const data = await api('/api/chat/rewrite-test-steps', {
        method: 'POST',
        signal: controller.signal,
        body: JSON.stringify({ model: $('chatModel').value, steps: current.steps }),
      });
      if (current !== session) return;
      if (!Array.isArray(data.steps) || data.steps.length !== current.steps.length) {
        throw new Error('The backend returned an incomplete rewrite. Please try again.');
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
      if (current === session) {
        current.request = null;
        controls();
      }
    }
  });

  function buttonFor(step, feedback) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tc-step-copy';
    button.setAttribute('aria-label', `Copy step ${step.step}`);
    button.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path></svg>';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        await copyTextToClipboard(testStepMarkdown.table([step]));
        feedback(`Step ${step.step} copied.`);
      } catch {
        feedback(copyError, true);
      }
    });
    return button;
  }

  return { open, buttonFor };
})();
