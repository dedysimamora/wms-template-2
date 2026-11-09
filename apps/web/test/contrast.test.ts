import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, wcagContrast } from 'culori';
import { describe, expect, it } from 'vitest';

/**
 * Gate kontras (frontend §3.3): untuk setiap brand × mode, pasangan wajib ≥ 4.5:1 (teks);
 * mode hc ≥ 7:1. Build klien gagal bila brand baru merusak keterbacaan.
 */
const webDir = path.resolve(import.meta.dirname, '..');
const globals = readFileSync(path.join(webDir, 'src/app/globals.css'), 'utf8');

function block(css: string, selector: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'g');
  for (const m of css.matchAll(re))
    for (const d of m[2]!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[d[1]!] = d[2]!.trim();
  return out;
}
function resolve(vars: Record<string, string>, name: string, depth = 0): string {
  const v = vars[name];
  if (!v) throw new Error(`token ${name} tidak terdefinisi`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  return ref && depth < 10 ? resolve(vars, ref[1]!, depth + 1) : v;
}

const PAIRS: Array<[fg: string, bg: string]> = [
  ['--foreground', '--background'],
  ['--foreground', '--surface-1'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--surface-2'],
  ['--foreground', '--surface-3'],
  ['--primary', '--background'],
  ['--primary-foreground', '--primary'],
  ['--primary', '--surface-1'],
  ['--status-success-fg', '--status-success-bg'],
  ['--status-warning-fg', '--status-warning-bg'],
  ['--status-danger-fg', '--status-danger-bg'],
  ['--status-info-fg', '--status-info-bg'],
  ['--status-neutral-fg', '--status-neutral-bg'],
];

const brands = readdirSync(path.join(webDir, 'brands'));
describe.each(brands)('brand %s', (brand) => {
  const tokens = block(
    readFileSync(path.join(webDir, 'brands', brand, 'tokens.css'), 'utf8'),
    ':root',
  );
  const light = { ...tokens, ...block(globals, ':root') };
  const modes = {
    light,
    dark: { ...light, ...block(globals, '.dark') },
    hc: { ...light, ...block(globals, '.hc') },
  };
  for (const [mode, vars] of Object.entries(modes)) {
    const min = mode === 'hc' ? 7 : 4.5;
    it.each(PAIRS)(`${mode}: %s di atas %s ≥ ${min}:1`, (fg, bg) => {
      const ratio = wcagContrast(parse(resolve(vars, fg))!, parse(resolve(vars, bg))!);
      expect(ratio, `${fg}/${bg} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
    });
  }
});
