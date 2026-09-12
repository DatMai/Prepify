const KEYWORDS = new Set([
  'const',
  'let',
  'var',
  'function',
  'return',
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'new',
  'class',
  'extends',
  'super',
  'this',
  'typeof',
  'instanceof',
  'in',
  'of',
  'async',
  'await',
  'yield',
  'try',
  'catch',
  'finally',
  'throw',
  'true',
  'false',
  'null',
  'undefined',
  'import',
  'export',
  'from',
  'default',
  'delete',
  'void',
]);

const BUILTINS = new Set([
  'console',
  'Promise',
  'Array',
  'Object',
  'JSON',
  'Math',
  'Date',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'AbortController',
  'AbortSignal',
  'Reflect',
  'Symbol',
  'Error',
  'TypeError',
  'ReferenceError',
  'SyntaxError',
  'Number',
  'String',
  'Boolean',
  'RegExp',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'queueMicrotask',
  'structuredClone',
  'fetch',
]);

function esc(s: string | undefined | null): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function highlightCode(code: string, lang: string): string {
  const isCodeLike =
    !lang ||
    lang === 'js' ||
    lang === 'ts' ||
    lang === 'javascript' ||
    lang === 'typescript' ||
    lang === 'output';
  if (!isCodeLike) {
    return esc(code);
  }

  let out = '';
  let i = 0;

  const wrap = (type: string, text: string): string =>
    `<span class="tok-${type}">${esc(text)}</span>`;

  while (i < code.length) {
    const ch = code[i];

    // Line comment: // ...
    if (ch === '/' && code[i + 1] === '/') {
      let j = i + 2;
      while (j < code.length && code[j] !== '\n') j++;
      out += wrap('com', code.slice(i, j));
      i = j;
      continue;
    }

    // Markdown-style note line for output blocks: *...*
    if (lang === 'output' && ch === '*' && (i === 0 || code[i - 1] === '\n')) {
      let j = i + 1;
      while (j < code.length && code[j] !== '\n') j++;
      out += wrap('com', code.slice(i, j));
      i = j;
      continue;
    }

    // Block comment: /* ... */
    if (ch === '/' && code[i + 1] === '*') {
      let j = i + 2;
      while (j < code.length && !(code[j] === '*' && code[j + 1] === '/')) j++;
      j = Math.min(code.length, j + 2);
      out += wrap('com', code.slice(i, j));
      i = j;
      continue;
    }

    // Strings: ' ', " ", `
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2;
          continue;
        }
        if (code[j] === quote) {
          j++;
          break;
        }
        j++;
      }
      out += wrap('str', code.slice(i, j));
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      const numRe = /^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/;
      const m = numRe.exec(code.slice(i));
      if (m) {
        out += wrap('num', m[0]);
        i += m[0].length;
        continue;
      }
    }

    // Identifier / keyword / builtin / function call
    if (/[A-Za-z_$]/.test(ch)) {
      const identRe = /^[A-Za-z_$][A-Za-z0-9_$]*/;
      const m = identRe.exec(code.slice(i));
      if (m) {
        const word = m[0];
        let peek = i + word.length;
        while (peek < code.length && /\s/.test(code[peek])) peek++;
        const next = peek < code.length ? code[peek] : '';
        const isCall = next === '(';

        if (KEYWORDS.has(word)) {
          out += wrap('kw', word);
        } else if (BUILTINS.has(word)) {
          out += wrap('built', word);
        } else if (isCall) {
          out += wrap('fn', word);
        } else {
          out += wrap('id', word);
        }
        i += word.length;
        continue;
      }
    }

    out += esc(ch);
    i++;
  }

  return out;
}
