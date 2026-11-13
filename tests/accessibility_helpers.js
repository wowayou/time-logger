// Browser-only acceptance helpers. Resolve CSS colors with the browser, then
// composite alpha/element opacity on the actual ancestor surfaces. This is not
// a whole-page WCAG scanner: image/gradient/mask surfaces require pixel sampling.
export async function composedContrast(locator, { property = 'color', pseudo = null, surfaceForeground = false } = {}) {
  return locator.evaluate((el, { property, pseudo, surfaceForeground }) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    function rgba(value) {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    }
    function over(fg, bg) {
      const a = fg[3] + bg[3] * (1 - fg[3]);
      return a ? [0, 1, 2].map(i => (fg[i] * fg[3] + bg[i] * bg[3] * (1 - fg[3])) / a).concat(a) : [0, 0, 0, 0];
    }
    const chain = [];
    for (let node = el; node; node = node.parentElement) chain.unshift(getComputedStyle(node));
    if (pseudo) chain.push(getComputedStyle(el, pseudo));
    for (const style of chain) {
      if (style.backgroundImage !== 'none' || style.filter !== 'none' || style.mixBlendMode !== 'normal'
        || style.maskImage !== 'none') throw new Error('Use pixel sampling for images, masks, filters or blends');
    }
    const foreground = rgba(chain.at(-1)[property]);
    function paint(index, under, text) {
      const style = chain[index];
      // A dot's background is the foreground shape; compare it with the
      // surrounding surface, not with that same painted dot again.
      let layer = surfaceForeground && index === chain.length - 1 ? [0, 0, 0, 0] : rgba(style.backgroundColor);
      if (index + 1 < chain.length) layer = paint(index + 1, layer, text);
      else if (text) layer = over(foreground, layer);
      layer[3] *= Number(style.opacity);
      return over(layer, under);
    }
    const bg = paint(0, [255, 255, 255, 1], false);
    const fg = paint(0, [255, 255, 255, 1], true);
    function luminance(color) {
      const [r, g, b] = color.map(c => {
        const v = c / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    const a = luminance(fg), b = luminance(bg);
    const style = chain.at(-1);
    const fontSize = parseFloat(style.fontSize), fontWeight = Number(style.fontWeight);
    return {
      foreground: fg.slice(0, 3), background: bg.slice(0, 3),
      ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      // WCAG 1.4.3: 18pt regular or 14pt bold, expressed in CSS px.
      textMinimum: fontSize >= 24 || (fontSize >= 14 * 4 / 3 && fontWeight >= 700) ? 3 : 4.5
    };
  }, { property, pseudo, surfaceForeground });
}

// Check a square of real hit points, including transparent pseudo-element
// extensions. A short text/border box alone does not prove a small target.
export async function targetHits(locator, size = 44) {
  return locator.evaluate((el, size) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const d = size / 2 - 0.5;
    return [-d, 0, d].flatMap(dx => [-d, 0, d].map(dy => {
      const target = document.elementFromPoint(x + dx, y + dy);
      return { dx, dy, hit: target === el || el.contains(target) };
    }));
  }, size);
}
