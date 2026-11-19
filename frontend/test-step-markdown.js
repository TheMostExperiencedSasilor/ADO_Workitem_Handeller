const testStepMarkdown = (() => {
  const blocks = new Set('address article aside blockquote div dl dt dd h1 h2 h3 h4 h5 h6 p pre section tr'.split(' '));
  const inline = new Set('a abbr b cite code del em font i ins kbd label mark q s samp small span strike strong sub sup u var'.split(' '));
  const structure = new Set('table tbody thead tfoot td th ol ul li'.split(' '));
  const blocked = new Set('script style iframe object embed svg math form button select textarea template head title'.split(' '));
  const voidTags = new Set('br hr img input link meta wbr'.split(' '));
  const tags = /<!--[\s\S]*?-->|<(\/?)([a-z][\w:.-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/gi;

  function protectLiteralTags(source) {
    const openings = new Map();
    const paired = new Set();
    for (const match of source.matchAll(tags)) {
      const [, close, tag] = match;
      if (!tag) continue;
      const name = tag.toLowerCase();
      if (!blocks.has(name) && !inline.has(name) && !structure.has(name)) continue;
      if (!openings.has(name)) openings.set(name, []);
      const open = openings.get(name);
      if (!close) {
        open.push(match);
      } else if (open.length) {
        // Prefer ADO's actual opening tag when the text includes a literal such as <P>.
        const exactCase = open.findLastIndex((candidate) => candidate[2] === tag);
        const [start] = open.splice(exactCase < 0 ? open.length - 1 : exactCase);
        paired.add(start.index);
        paired.add(match.index);
      }
    }
    return source.replace(tags, (match, _close, tag, offset) => {
      if (!tag) return match;
      const name = tag.toLowerCase();
      if (blocked.has(name) || voidTags.has(name) || paired.has(offset)) return match;
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    });
  }

  function plainText(value, stepPrefix) {
    const template = document.createElement('template');
    // A template parses HTML without activating its scripts, images, or other resources.
    template.innerHTML = protectLiteralTags(String(value ?? ''));

    function children(element, inPre) {
      let output = '';
      for (const child of element.childNodes) {
        if (child.nodeType === 3) {
          const content = child.textContent;
          if (!inPre && !content.trim() && /[\r\n]/.test(content) && element.childElementCount) {
            if (output && !/\s$/.test(output)) output += ' ';
            continue;
          }
          output += content;
          continue;
        }
        if (child.nodeType !== 1) continue;
        const tag = child.localName;
        if (blocked.has(tag)) continue;
        if (tag === 'br' || tag === 'hr') output += '\n';
        else if (tag === 'img') output += child.getAttribute('alt') || '';
        else {
          const block = blocks.has(tag) || tag === 'ul' || tag === 'ol';
          if (block && output && !output.endsWith('\n')) output += '\n';
          if ((tag === 'td' || tag === 'th') && child.previousElementSibling) output += ' | ';
          output += tag === 'ul' || tag === 'ol'
            ? list(child, inPre)
            : children(child, inPre || tag === 'pre');
          if (block && !output.endsWith('\n')) output += '\n';
        }
      }
      return output;
    }

    function list(element, inPre) {
      const ordered = element.localName === 'ol';
      let number = element.start;
      return [...element.children].filter((item) => item.localName === 'li').map((item) => {
        if (ordered && item.hasAttribute('value')) number = item.value;
        const marker = ordered ? number++ + '. ' : '- ';
        return marker + children(item, inPre).trim().replace(/\n(?=.)/g, '\n' + ' '.repeat(marker.length));
      }).join('\n');
    }

    const output = children(template.content, false).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ')
      .replace(/[ \t]+(?=\n)/g, '').trim();
    // Remove authored row numbers but keep numbering added by an ordered HTML list.
    if (stepPrefix && (!template.content.querySelector('ol') || stepPrefix.test(template.content.textContent.trim()))) {
      return output.replace(stepPrefix, '');
    }
    return output;
  }

  function normalize(step, index) {
    const number = index + 1;
    const prefix = new RegExp('^(?:step[ \\t]+' + number + '[ \\t]*[:.)-][ \\t]*|'
      + number + '[:.)][ \\t]+)', 'i');
    return { step: number, action: plainText(step.action, prefix), expected: plainText(step.expected) };
  }

  function cell(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/[\\|*_\x60[\]~]/g, '\\$&').replace(/\r\n?|\n/g, '<br>');
  }

  function table(steps) {
    return ['| Step | Action | Expected result |', '|---|---|---|',
      ...steps.map(({ step, action, expected }) => '| ' + step + ' | ' + cell(action) + ' | ' + cell(expected) + ' |'),
    ].join('\n');
  }

  function validRewrite(steps, source) {
    return Array.isArray(steps) && steps.length === source.length && steps.every((row, index) =>
      row && Object.keys(row).length === 3 && row.step === source[index].step
      && typeof row.action === 'string' && row.action.trim()
      && typeof row.expected === 'string' && row.expected.trim());
  }

  return { protectLiteralTags, normalize, table, validRewrite };
})();
