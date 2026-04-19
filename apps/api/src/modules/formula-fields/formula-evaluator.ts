/**
 * Minimal sandboxed formula evaluator. No `eval`, no `new Function`.
 *
 * Grammar (whitespace ignored):
 *   expr     := term (('+' | '-') term)*
 *   term     := factor (('*' | '/') factor)*
 *   factor   := NUMBER | STRING | ident | call | '(' expr ')'
 *   call     := ident '(' [ expr (',' expr)* ] ')'
 *   ident    := [a-zA-Z_][a-zA-Z0-9_]*
 *
 * Supported built-ins: CONCAT(a,b,…), IF(cond, a, b), UPPER(s), LOWER(s),
 * LEN(s), NUMBER(x), ROUND(x).
 *
 * Variables are looked up in the `context` map. Missing vars → empty string / 0.
 */

type Token =
  | { kind: 'NUM'; value: number }
  | { kind: 'STR'; value: string }
  | { kind: 'IDENT'; value: string }
  | { kind: 'PUNCT'; value: '(' | ')' | ',' | '+' | '-' | '*' | '/' };

const IDENT_RE = /^[a-zA-Z_][a-zA-Z0-9_]*/;

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    if ('+-*/(),'.includes(c)) {
      out.push({ kind: 'PUNCT', value: c as Token extends { kind: 'PUNCT'; value: infer V } ? V : never });
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
      out.push({ kind: 'IDENT', value: m[0] });
      i += m[0].length;
      continue;
    }
    throw new Error(`Unexpected character '${c}' at ${i}`);
  }
  return out;
}

type Ctx = Record<string, unknown>;

export function evaluateFormula(expression: string, context: Ctx): string | number | boolean {
  const tokens = tokenize(expression);
  let pos = 0;

  function peek(): Token | undefined { return tokens[pos]; }
  function eat(): Token { return tokens[pos++]; }

  function parseExpr(): unknown {
    let left = parseTerm();
    while (peek()?.kind === 'PUNCT' && (peek()!.value === '+' || peek()!.value === '-')) {
      const op = (eat() as { value: string }).value;
      const right = parseTerm();
      if (op === '+') {
        if (typeof left === 'number' && typeof right === 'number') left = left + right;
        else left = String(left) + String(right);
      } else {
        left = Number(left) - Number(right);
      }
    }
    return left;
  }

  function parseTerm(): unknown {
    let left = parseFactor();
    while (peek()?.kind === 'PUNCT' && (peek()!.value === '*' || peek()!.value === '/')) {
      const op = (eat() as { value: string }).value;
      const right = parseFactor();
      left = op === '*' ? Number(left) * Number(right) : Number(left) / Number(right);
    }
    return left;
  }

  function parseFactor(): unknown {
    const t = peek();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'NUM') { eat(); return t.value; }
    if (t.kind === 'STR') { eat(); return t.value; }
    if (t.kind === 'PUNCT' && t.value === '(') {
      eat();
      const v = parseExpr();
      if (peek()?.value !== ')') throw new Error('Expected )');
      eat();
      return v;
    }
    if (t.kind === 'IDENT') {
      eat();
      if (peek()?.kind === 'PUNCT' && peek()!.value === '(') {
        eat();
        const args: unknown[] = [];
        if (peek()?.value !== ')') {
          args.push(parseExpr());
          while (peek()?.value === ',') { eat(); args.push(parseExpr()); }
        }
        if (peek()?.value !== ')') throw new Error('Expected )');
        eat();
        return callBuiltin(t.value, args);
      }
      // Variable lookup from context.
      return context[t.value] ?? '';
    }
    throw new Error(`Unexpected token ${JSON.stringify(t)}`);
  }

  function callBuiltin(name: string, args: unknown[]): unknown {
    switch (name) {
      case 'CONCAT': return args.map((a) => String(a ?? '')).join('');
      case 'IF': return args[0] ? args[1] : args[2];
      case 'UPPER': return String(args[0] ?? '').toUpperCase();
      case 'LOWER': return String(args[0] ?? '').toLowerCase();
      case 'LEN': return String(args[0] ?? '').length;
      case 'NUMBER': return Number(args[0]);
      case 'ROUND': return Math.round(Number(args[0]));
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
