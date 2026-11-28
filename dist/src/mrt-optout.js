/** Replace WGSL line (`//`) and nested block (`/* ... *\/`) comments with spaces, preserving byte offsets & newlines. */
function maskComments(src) {
    const n = src.length;
    const out = new Array(n);
    let i = 0;
    let blockDepth = 0;
    while (i < n) {
        const c = src[i];
        const next = i + 1 < n ? src[i + 1] : '';
        if (blockDepth > 0) {
            if (c === '/' && next === '*') {
                out[i] = ' ';
                out[i + 1] = ' ';
                i += 2;
                blockDepth++;
            }
            else if (c === '*' && next === '/') {
                out[i] = ' ';
                out[i + 1] = ' ';
                i += 2;
                blockDepth--;
            }
            else {
                out[i] = c === '\n' ? '\n' : ' ';
                i++;
            }
        }
        else if (c === '/' && next === '/') {
            while (i < n && src[i] !== '\n') {
                out[i] = ' ';
                i++;
            }
        }
        else if (c === '/' && next === '*') {
            out[i] = ' ';
            out[i + 1] = ' ';
            i += 2;
            blockDepth = 1;
        }
        else {
            out[i] = c;
            i++;
        }
    }
    return out.join('');
}
/** Find index of matching closer (`)` or `}`) for opener at `openIdx` in comment-masked WGSL, or -1. */
function matchDelim(masked, openIdx, open, close) {
    let depth = 0;
    for (let i = openIdx; i < masked.length; i++) {
        const c = masked[i];
        if (c === open)
            depth++;
        else if (c === close) {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}
/** Split a comma/semicolon-separated WGSL list at top level (respecting `(...)` and `<...>` nesting). */
function splitTopLevel(text, seps) {
    const parts = [];
    let pDepth = 0, aDepth = 0, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '(')
            pDepth++;
        else if (c === ')')
            pDepth = Math.max(0, pDepth - 1);
        else if (c === '<')
            aDepth++;
        else if (c === '>')
            aDepth = Math.max(0, aDepth - 1);
        else if (pDepth === 0 && aDepth === 0 && seps.includes(c)) {
            parts.push(text.slice(start, i));
            start = i + 1;
        }
    }
    parts.push(text.slice(start));
    return parts.map((s) => s.trim()).filter((s) => s.length > 0);
}
/** Strip WGSL `@attr` and `@attr(...)` annotations from the front of a parameter or field declaration. */
function stripLeadingAttrs(decl) {
    let s = decl.trim();
    while (s.startsWith('@')) {
        const m = /^@[A-Za-z_]\w*/.exec(s);
        if (!m)
            break;
        let end = m[0].length;
        while (end < s.length && /\s/.test(s[end]))
            end++;
        if (s[end] === '(') {
            const close = matchDelim(s, end, '(', ')');
            if (close < 0)
                break;
            end = close + 1;
        }
        s = s.slice(end).trimStart();
    }
    return s;
}
/** Pad a replacement string with `\n` so replacing `orig` keeps identical 1-based line numbers for diagnostics. */
function preserveLines(orig, replacement) {
    const origLines = (orig.match(/\n/g) ?? []).length;
    const repLines = (replacement.match(/\n/g) ?? []).length;
    return repLines < origLines ? replacement + '\n'.repeat(origLines - repLines) : replacement;
}
/**
 * Rewrite a WGSL fragment entry point `fsName` so it also outputs `vec4f(0.0)` at `@location(loc)`.
 * Returns the transformed WGSL source string, or `null` if the entry signature cannot be safely wrapped.
 */
export function wrapFragmentZeroLocation(code, fsName, loc) {
    const masked = maskComments(code);
    const re = /@fragment\b/g;
    let m;
    let match = null;
    while ((m = re.exec(masked)) !== null) {
        let i = m.index + m[0].length;
        // Skip whitespace and any extra attributes between @fragment and fn
        while (i < masked.length) {
            while (i < masked.length && /\s/.test(masked[i]))
                i++;
            if (masked[i] === '@') {
                const am = /^@[A-Za-z_]\w*/.exec(masked.slice(i));
                if (!am)
                    break;
                i += am[0].length;
                while (i < masked.length && /\s/.test(masked[i]))
                    i++;
                if (masked[i] === '(') {
                    const close = matchDelim(masked, i, '(', ')');
                    if (close < 0)
                        break;
                    i = close + 1;
                }
            }
            else {
                break;
            }
        }
        const fnRe = new RegExp(`^fn\\s+${fsName}\\s*\\(`);
        const fm = fnRe.exec(masked.slice(i));
        if (!fm)
            continue;
        const paramsStart = i + fm[0].length - 1;
        const paramsEnd = matchDelim(masked, paramsStart, '(', ')');
        if (paramsEnd < 0)
            continue;
        let j = paramsEnd + 1;
        while (j < masked.length && /\s/.test(masked[j]))
            j++;
        if (masked.slice(j, j + 2) !== '->')
            continue;
        const arrowEnd = j + 2;
        const braceStart = masked.indexOf('{', arrowEnd);
        if (braceStart < 0)
            continue;
        match = { headerStart: m.index, paramsStart, paramsEnd, arrowEnd, braceStart };
        break;
    }
    if (!match)
        return null;
    const origHeader = code.slice(match.headerStart, match.braceStart + 1);
    const origParams = code.slice(match.paramsStart + 1, match.paramsEnd);
    const maskedParams = masked.slice(match.paramsStart + 1, match.paramsEnd);
    const paramDecls = splitTopLevel(maskedParams, ',');
    const strippedParams = [];
    const argNames = [];
    for (const pd of paramDecls) {
        const clean = stripLeadingAttrs(pd);
        const colon = clean.indexOf(':');
        if (colon < 0)
            return null;
        const name = clean.slice(0, colon).trim();
        if (!/^[A-Za-z_]\w*$/.test(name))
            return null;
        strippedParams.push(clean);
        argNames.push(name);
    }
    const retMasked = masked.slice(match.arrowEnd, match.braceStart).trim();
    const helperName = `__weft_z${loc}_${fsName}`;
    const outStructName = `__WeftZ${loc}_${fsName}`;
    // Case 1: direct `@location(k) Type` return (e.g. `-> @location(0) vec4f`)
    if (retMasked.includes('@')) {
        const locMatch = /@location\s*\(\s*(\d+)\s*\)/.exec(retMasked);
        if (!locMatch)
            return null;
        const retLoc = Number(locMatch[1]);
        if (retLoc === loc)
            return null;
        const retType = stripLeadingAttrs(retMasked);
        if (!retType)
            return null;
        const newHeader = preserveLines(origHeader, `fn ${helperName}(${strippedParams.join(', ')}) -> ${retType} {`);
        const wrapper = `\nstruct ${outStructName} { @location(${retLoc}) _c0: ${retType}, @location(${loc}) _c${loc}: vec4f }\n`
            + `@fragment fn ${fsName}(${origParams}) -> ${outStructName} {\n`
            + `  return ${outStructName}(${helperName}(${argNames.join(', ')}), vec4f(0.0));\n`
            + `}\n`;
        return code.slice(0, match.headerStart) + newHeader + code.slice(match.braceStart + 1) + wrapper;
    }
    // Case 2: struct return (e.g. `-> FOutM` carrying @location(0), @location(1), optional @builtin(frag_depth))
    if (!/^[A-Za-z_]\w*$/.test(retMasked))
        return null;
    const structName = retMasked;
    const sm = new RegExp(`\\bstruct\\s+${structName}\\s*\\{`).exec(masked);
    if (!sm)
        return null;
    const sOpen = sm.index + sm[0].length - 1;
    const sClose = matchDelim(masked, sOpen, '{', '}');
    if (sClose < 0)
        return null;
    const sBodyMasked = masked.slice(sOpen + 1, sClose);
    const members = splitTopLevel(sBodyMasked, ',;');
    if (!members.length)
        return null;
    const fieldNames = [];
    for (const mem of members) {
        if (new RegExp(`@location\\s*\\(\\s*${loc}\\s*\\)`).test(mem))
            return null;
        const clean = stripLeadingAttrs(mem);
        const colon = clean.indexOf(':');
        if (colon < 0)
            return null;
        const fn = clean.slice(0, colon).trim();
        if (!/^[A-Za-z_]\w*$/.test(fn))
            return null;
        fieldNames.push(fn);
    }
    const newHeader = preserveLines(origHeader, `fn ${helperName}(${strippedParams.join(', ')}) -> ${structName} {`);
    const wrapper = `\nstruct ${outStructName} { ${members.join(', ')}, @location(${loc}) _c${loc}: vec4f }\n`
        + `@fragment fn ${fsName}(${origParams}) -> ${outStructName} {\n`
        + `  let _r = ${helperName}(${argNames.join(', ')});\n`
        + `  return ${outStructName}(${fieldNames.map((f) => `_r.${f}`).join(', ')}, vec4f(0.0));\n`
        + `}\n`;
    return code.slice(0, match.headerStart) + newHeader + code.slice(match.braceStart + 1) + wrapper;
}
const cache = new WeakMap();
/** Return a cached derived `Shader` whose fragment entry `fsName` writes `vec4f(0.0)` to `@location(loc)`. */
export function shaderWithZeroLocation(shader, fsName, loc) {
    let byKey = cache.get(shader);
    if (!byKey)
        cache.set(shader, (byKey = new Map()));
    const key = `${fsName}:${loc}`;
    const hit = byKey.get(key);
    if (hit && hit.version === shader.version)
        return hit.shader;
    const wrappedCode = wrapFragmentZeroLocation(shader.code, fsName, loc);
    if (!wrappedCode)
        return shader;
    const entries = shader.reflect.entries.map((e) => {
        if (e.stage !== 'fragment' || e.name !== fsName)
            return e;
        const prev = e.targetLocations ?? Array.from({ length: e.targets ?? 1 }, (_, i) => i);
        const next = prev.includes(loc) ? prev : [...prev, loc].sort((a, b) => a - b);
        return { ...e, targets: Math.max(e.targets ?? 1, loc + 1), targetLocations: next };
    });
    const derived = Object.create(shader, {
        id: { value: `${shader.id}#z${loc}:${fsName}`, enumerable: true },
        label: { value: `${shader.label}#z${loc}`, enumerable: true },
        code: { value: wrappedCode, enumerable: true },
        reflect: { value: { ...shader.reflect, entries }, enumerable: true },
        version: { get: () => shader.version, enumerable: true },
    });
    byKey.set(key, { version: shader.version, shader: derived });
    return derived;
}
//# sourceMappingURL=mrt-optout.js.map