/**
 * Sandboxed formula evaluator. No `eval`, no `new Function`.
 *
 * Grammar (whitespace ignored, operators precedence low → high):
 *   expr    := orExpr
 *   orExpr  := andExpr ('OR' andExpr)*
 *   andExpr := notExpr ('AND' notExpr)*
 *   notExpr := 'NOT' notExpr | cmpExpr
 *   cmpExpr := addExpr (('='|'!='|'<='|'>='|'<'|'>') addExpr)?
 *   addExpr := mulExpr (('+'|'-') mulExpr)*
 *   mulExpr := unary  (('*'|'/') unary)*
 *   unary   := '-' unary | factor
 *   factor  := NUMBER | STRING | BOOL | ident | call | '(' expr ')'
 *   call    := ident '(' [ expr (',' expr)* ] ')'
 *   ident   := [a-zA-Z_][a-zA-Z0-9_]*
 *
 * Built-ins: CONCAT, IF, UPPER, LOWER, LEN, NUMBER, ROUND, TRIM,
 *            ABS, MIN, MAX, COALESCE.
 *
 * Keywords: TRUE, FALSE, AND, OR, NOT — case-insensitive.
 * Variables resolved from `context`; missing vars → empty string.
 */

type PunctValue = '(' | ')' | ',' | '+' | '-' | '*' | '/' | '=' | '<' | '>' | '<=' | '>=' | '!=';
type Token =
  | { kind: 'NUM'; value: number }
  | { kind: 'STR'; value: string }
  | { kind: 'BOOL'; value: boolean }
  | { kind: 'IDENT'; value: string }
  | { kind: 'KW'; value: 'AND' | 'OR' | 'NOT' }
  | { kind: 'PUNCT'; value: PunctValue };

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*/;
const KEYWORDS: Record<string, 'AND' | 'OR' | 'NOT' | 'TRUE' | 'FALSE'> = {
  AND: 'AND', OR: 'OR', NOT: 'NOT', TRUE: 'TRUE', FALSE: 'FALSE',
};

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }

    // Multi-char comparison operators first.
    const two = src.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '!=') {
      out.push({ kind: 'PUNCT', value: two as PunctValue });
      i += 2;
      continue;
    }
    if ('+-*/(),=<>'.includes(c)) {
      out.push({ kind: 'PUNCT', value: c as PunctValue });
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let end = i + 1;
      while (end < src.length && src[end] !== quote) end++;
      if (end >= src.length) throw new Error('Unterminated string');
      out.push({ kind: 'STR', value: src.slice(i + 1, end) });
      i = end + 1;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let end = i;
      while (end < src.length && /[0-9.]/.test(src[end])) end++;
      out.push({ kind: 'NUM', value: Number(src.slice(i, end)) });
      i = end;
      continue;
    }
    const m = IDENT_RE.exec(src.slice(i));
    if (m) {
      const word = m[0];
      const up = word.toUpperCase();
      if (up === 'TRUE' || up === 'FALSE') {
        out.push({ kind: 'BOOL', value: up === 'TRUE' });
      } else if (KEYWORDS[up] === 'AND' || KEYWORDS[up] === 'OR' || KEYWORDS[up] === 'NOT') {
        out.push({ kind: 'KW', value: up as 'AND' | 'OR' | 'NOT' });
      } else {
        out.push({ kind: 'IDENT', value: word });
      }
      i += word.length;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at ${i}`);
  }
  return out;
}

type Ctx = Record<string, unknown>;

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return v != null;
}

function compare(op: string, a: unknown, b: unknown): boolean {
  // Numeric compare when both sides coerce to finite numbers; lexicographic otherwise.
  const na = Number(a);
  const nb = Number(b);
  const bothNum = !Number.isNaN(na) && !Number.isNaN(nb) && typeof a !== 'boolean' && typeof b !== 'boolean';
  const l = bothNum ? na : String(a ?? '');
  const r = bothNum ? nb : String(b ?? '');
  switch (op) {
    case '=': return l === r;
    case '!=': return l !== r;
    case '<': return l < r;
    case '>': return l > r;
    case '<=': return l <= r;
    case '>=': return l >= r;
    default: throw new Error(`Unknown comparison ${op}`);
  }
}

export function evaluateFormula(expression: string, context: Ctx): string | number | boolean {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function eat(): Token { return tokens[pos++]; }
  function isPunct(v: PunctValue): boolean {
    const t = peek();
    return !!t && t.kind === 'PUNCT' && t.value === v;
  }
  function isKw(v: 'AND' | 'OR' | 'NOT'): boolean {
    const t = peek();
    return !!t && t.kind === 'KW' && t.value === v;
  }

  function parseExpr(): unknown { return parseOr(); }

  function parseOr(): unknown {
    let left = parseAnd();
    while (isKw('OR')) {
      eat();
      const right = parseAnd();
      left = truthy(left) || truthy(right);
    }
    return left;
  }

  function parseAnd(): unknown {
    let left = parseNot();
    while (isKw('AND')) {
      eat();
      const right = parseNot();
      left = truthy(left) && truthy(right);
    }
    return left;
  }

  function parseNot(): unknown {
    if (isKw('NOT')) { eat(); return !truthy(parseNot()); }
    return parseCmp();
  }

  function parseCmp(): unknown {
    const left = parseAdd();
    const t = peek();
    if (t && t.kind === 'PUNCT' && ['=', '!=', '<', '>', '<=', '>='].includes(t.value)) {
      const op = (eat() as { value: string }).value;
      const right = parseAdd();
      return compare(op, left, right);
    }
    return left;
  }

  function parseAdd(): unknown {
    let left = parseMul();
    while (isPunct('+') || isPunct('-')) {
      const op = (eat() as { value: string }).value;
      const right = parseMul();
      if (op === '+') {
        if (typeof left === 'number' && typeof right === 'number') left = left + right;
        else left = String(left ?? '') + String(right ?? '');
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  }

  function parseMul(): unknown {
    let left = parseUnary();
    while (isPunct('*') || isPunct('/')) {
      const op = (eat() as { value: string }).value;
      const right = parseUnary();
      if (op === '*') {
        left = Number(left) * Number(right);
      } else {
        const rn = Number(right);
        if (rn === 0) throw new Error('Division by zero');
        left = Number(left) / rn;
      }
    }
    return left;
  }

  function parseUnary(): unknown {
    if (isPunct('-')) { eat(); return -Number(parseUnary()); }
    if (isPunct('+')) { eat(); return parseUnary(); }
    return parseFactor();
  }

  function parseFactor(): unknown {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'NUM') { eat(); return t.value; }
    if (t.kind === 'STR') { eat(); return t.value; }
    if (t.kind === 'BOOL') { eat(); return t.value; }
    if (t.kind === 'PUNCT' && t.value === '(') {
      eat();
      const v = parseExpr();
      if (!isPunct(')')) throw new Error('Expected )');
      eat();
      return v;
    }
    if (t.kind === 'IDENT') {
      eat();
      if (isPunct('(')) {
        eat();
        const args: unknown[] = [];
        if (!isPunct(')')) {
          args.push(parseExpr());
          while (isPunct(',')) { eat(); args.push(parseExpr()); }
        }
        if (!isPunct(')')) throw new Error('Expected )');
        eat();
        return callBuiltin(t.value, args);
      }
      return context[t.value] ?? '';
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  }

  function callBuiltin(name: string, args: unknown[]): unknown {
    switch (name.toUpperCase()) {
      case 'CONCAT': return args.map((a) => String(a ?? '')).join('');
      case 'IF': return truthy(args[0]) ? args[1] : args[2];
      case 'UPPER': return String(args[0] ?? '').toUpperCase();
      case 'LOWER': return String(args[0] ?? '').toLowerCase();
      case 'TRIM': return String(args[0] ?? '').trim();
      case 'LEN': return String(args[0] ?? '').length;
      case 'NUMBER': return Number(args[0]);
      case 'ROUND': return Math.round(Number(args[0]));
      case 'ABS': return Math.abs(Number(args[0]));
      case 'MIN': return Math.min(...args.map((a) => Number(a)));
      case 'MAX': return Math.max(...args.map((a) => Number(a)));
      case 'COALESCE': return args.find((a) => a != null && a !== '') ?? '';
      default: throw new Error(`Unknown function: ${name}`);
    }
  }

  const result = parseExpr();
  if (pos < tokens.length) throw new Error('Unexpected trailing input');
  if (typeof result === 'number' || typeof result === 'boolean' || typeof result === 'string') {
    return result;
  }
  return String(result);
}
