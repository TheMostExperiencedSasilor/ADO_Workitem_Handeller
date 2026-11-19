const testStepMarkdown = (() => {
  const blocks = new Set('ADDRESS ARTICLE ASIDE BLOCKQUOTE CAPTION DD DIV DL DT FIGCAPTION FIGURE FOOTER H1 H2 H3 H4 H5 H6 HEADER LI MAIN NAV OL P PRE SECTION TABLE TR UL'.split(' '));
  const omitted = new Set('EMBED HEAD IFRAME LINK MATH META NOSCRIPT OBJECT SCRIPT STYLE SVG TEMPLATE'.split(' '));
  const html = new Set([
    ...blocks, ...omitted,
    ...'A ABBR B BDI BDO BR BUTTON CENTER CITE CODE COL COLGROUP DEL DETAILS EM FONT FORM HR I IMG INPUT INS KBD LABEL MARK O:P Q S SAMP SMALL SPAN STRIKE STRONG SUB SUMMARY SUP TBODY TD TFOOT TH THEAD TIME U VAR WBR'.split(' '),
  ]);

  function parseHtml(value) {
    const template = document.createElement('template');
    const source = String(value ?? '');
    const closingTags = new Set([...source.matchAll(/<\/([a-z][\w.:-]*)\s*>/gi)]
      .map((tag) => tag[1].toUpperCase()));
    // Preserve literal ADO references such as <LNG Section> or <Sample.hsc>.
    template.innerHTML = source.replace(
      /<!--[\s\S]*?-->|<\/?([a-z][^\s<>/]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>|<\/?([a-z][^\s<>/]*)(?=[\s/>])[^<>]*>/gi,
      (tag, name, fallback) => {
        const label = name || fallback;
        if (!label) return tag;
        const upper = label.toUpperCase();
        const literalName = blocks.has(upper) && /^[A-Z][a-z]/.test(label)
          && tag === `<${label}>` && !closingTags.has(upper);
        return html.has(upper) && !literalName ? tag : tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
      },
    );
    return template.content;
  }

  function plainText(value, step) {
    let result = '';
    let startsWithList = false;
    function lineBreak() {
      if (result && !/\n[ \t]*$/.test(result)) result += '\n';
    }

    function read(parent, preformatted = false, depth = 0) {
      const ordered = parent.tagName === 'OL';
      let number = ordered ? parent.start : 1;
      const contentStart = result.length;
      for (const child of parent.childNodes) {
        if (child.nodeType === 3) {
          const text = child.textContent.replaceAll('\u00a0', ' ').replace(/\r\n?/g, '\n');
          result += preformatted ? text : text.replace(/[\t\f ]+/g, ' ');
          continue;
        }
        if (child.nodeType !== 1 || omitted.has(child.tagName)) continue;
        const tag = child.tagName;
        if (tag === 'BR') { result += '\n'; continue; }
        if (tag === 'HR') { lineBreak(); continue; }
        if (tag === 'IMG') { result += child.getAttribute('alt') || ''; continue; }
        const firstListParagraph = parent.tagName === 'LI' && result.length === contentStart
          && (tag === 'DIV' || tag === 'P');
        if (blocks.has(tag) && !firstListParagraph) lineBreak();
        if (tag === 'LI') {
          if (!result.trim()) startsWithList = true;
          if (ordered && child.hasAttribute('value')) number = child.value;
          result += '  '.repeat(Math.max(0, depth - 1)) + (ordered ? `${number++}. ` : '- ');
        }
        if ((tag === 'TD' || tag === 'TH') && child.previousElementSibling) result += ' | ';
        read(child, preformatted || tag === 'PRE', depth + Number(tag === 'OL' || tag === 'UL'));
        if (blocks.has(tag)) lineBreak();
      }
    }
    read(parseHtml(value));
    result = result.replace(/[ \t]+$/gm, '').trim();
    if (step != null && !startsWithList) {
      const number = String(step).replaceAll('.', '\\.');
      const prefix = new RegExp(`^(?:Step[ \\t]+${number}(?:[.):–-][ \\t]*|[ \\t]+(?=\\S))|${number}[.):][ \\t]+)\\s*`, 'i');
      result = result.replace(prefix, '');
    }
    return result;
  }

  function prepare(steps) {
    return steps.map(({ action, expected, number }, index) => {
      const step = String(number ?? index + 1);
      return { step, action: plainText(action, step), expected: plainText(expected) };
    });
  }

  function escapeCell(value) {
    return String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
      .replace(/[\\|*_`~\[\]]/g, '\\$&')
      .replace(/\r\n?|\n/g, '<br>');
  }

  function table(steps) {
    return ['| Step | Action | Expected result |', '|---|---|---|',
      ...steps.map(({ step, action, expected }) =>
        `| ${step} | ${escapeCell(action)} |${expected ? ` ${escapeCell(expected)}` : ''} |`),
    ].join('\n');
  }

  return { parseHtml, prepare, table };
})();
