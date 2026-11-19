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
    const tags = /<!--[\s\S]*?-->|<\/?([a-z][^\s<>/]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>|<\/?([a-z][^\s<>/]*)(?=[\s/>])[^<>]*>/gi;
    const openings = new Map();
    const paired = new Set();
    // Prefer the spelling of the closing tag when a literal such as <P> sits inside <p>.
    for (const match of source.matchAll(tags)) {
      const label = match[1] || match[2];
      if (!label) continue;
      const upper = label.toUpperCase();
      if (!html.has(upper)) continue;
      if (!openings.has(upper)) openings.set(upper, []);
      const open = openings.get(upper);
      if (!match[0].startsWith('</')) {
        open.push({ label, index: match.index });
      } else if (open.length) {
        const exactCase = open.findLastIndex((entry) => entry.label === label);
        const [start] = open.splice(exactCase < 0 ? open.length - 1 : exactCase, 1);
        paired.add(start.index);
      }
    }
    // Preserve literal ADO references such as <LNG Section> or <Sample.hsc>.
    template.innerHTML = source.replace(tags, (tag, name, fallback, offset) => {
      const label = name || fallback;
      if (!label) return tag;
      const upper = label.toUpperCase();
      const literalName = blocks.has(upper) && label !== label.toLowerCase()
        && tag === `<${label}>` && !paired.has(offset);
      return html.has(upper) && !literalName ? tag : tag.replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    });
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

  function validRewrite(steps, source) {
    return Array.isArray(steps) && steps.length === source.length && steps.every((row, index) =>
      row && Object.keys(row).length === 3 && row.step === source[index].step
      && typeof row.action === 'string' && (!source[index].action.trim() || row.action.trim())
      && typeof row.expected === 'string' && row.expected.trim());
  }

  return { parseHtml, prepare, table, validRewrite };
})();
