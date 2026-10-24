import type jsPDF from 'jspdf';

/** 2D affine matrix [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f. */
export type Affine = [number, number, number, number, number, number];

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

export function multiply(m: Affine, n: Affine): Affine {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

/** Uniform length scale of a matrix (world unit → paper mm). */
export function matrixScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export interface RGBA { r: number; g: number; b: number; a: number }

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', red: '#ff0000',
  green: '#008000', blue: '#0000ff', transparent: '#00000000', none: '#00000000',
};

export function parseColor(value: unknown, fallback: RGBA = { r: 0, g: 0, b: 0, a: 1 }): RGBA {
  if (typeof value !== 'string') return fallback;
  let text = value.trim().toLowerCase();
  if (NAMED[text]) text = NAMED[text];
  const hex = /^#([0-9a-f]{3,8})$/.exec(text);
  if (hex) {
    let h = hex[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map(c => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return fallback;
    return {
      r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
      a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
    }
  }
  return fallback;
}

export type TextAlign = 'left' | 'center' | 'right';
export type TextBaseline = 'alphabetic' | 'middle' | 'top' | 'bottom';

/** Up vector on the page (y down) for text drawn at a counter-clockwise angle in degrees. */
export function textUp(angle: number) {
  const r = angle * Math.PI / 180;
  return { x: -Math.sin(r), y: -Math.cos(r) };
}

/** Draws (multi-line) text rotated counter-clockwise by `angle` degrees.
 * Alignment and baseline are applied along the rotated text axes, which jsPDF does not do itself. */
export function drawRotatedText(pdf: jsPDF, text: string | string[], x: number, y: number, options: { angle?: number; align?: TextAlign; baseline?: TextBaseline; heightMm: number; lineHeight?: number }) {
  const angle = options.angle ?? 0, h = options.heightMm, r = angle * Math.PI / 180;
  const along = { x: Math.cos(r), y: -Math.sin(r) }, up = textUp(angle);
  const lines = (Array.isArray(text) ? text : String(text).split('\n')).filter(l => l !== undefined);
  const step = h * (options.lineHeight ?? 1.25);
  const block = step * (lines.length - 1);
  const baseShift = options.baseline === 'middle' ? -0.36 * h + block / 2
    : options.baseline === 'top' ? -0.78 * h
    : options.baseline === 'bottom' ? 0.22 * h + block
    : 0;
  lines.forEach((line, i) => {
    const w = pdf.getTextWidth(line);
    const shift = options.align === 'center' ? -w / 2 : options.align === 'right' ? -w : 0;
    const down = i * step - baseShift; // positive = further down the text block
    const px = x + along.x * shift - up.x * down, py = y + along.y * shift - up.y * down;
    pdf.text(line, px, py, angle ? { angle } as never : undefined);
  });
}

export interface SymbolStyle {
  /** Monochrome technical drawing: strokes dark grey, fills near-white. */
  mono: boolean;
  /** Stroke width clamp in mm. */
  minLine: number;
  maxLine: number;
  /** Optional fixed stroke colour override (hex). */
  strokeColor?: string;
}

/** Canvas-like adapter that writes vector paths into a jsPDF page.
 * It supports exactly the drawing commands the shared furniture and stair symbols use
 * (the same set as canvasSymbolSvg), so plan symbols print as real vectors at true scale. */
export function pdfSymbolContext(pdf: jsPDF, base: Affine, style: SymbolStyle): CanvasRenderingContext2D {
  let transform: Affine = base;
  let subpaths: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] | null = null;
  let last: { x: number; y: number } | null = null; // local coordinates
  const stack: { transform: Affine; styles: Record<string, unknown> }[] = [];

  const toPaper = (x: number, y: number) => apply(transform, x, y);
  const begin = (x: number, y: number) => {
    current = [toPaper(x, y)];
    subpaths.push(current);
    last = { x, y };
  };
  const to = (x: number, y: number) => {
    if (!current) begin(x, y);
    else { current.push(toPaper(x, y)); last = { x, y }; }
  };

  const setStroke = (ctx: { strokeStyle: unknown; lineWidth: number }) => {
    const c = style.strokeColor ? parseColor(style.strokeColor) : parseColor(ctx.strokeStyle);
    if (style.mono) {
      const grey = Math.min(80, Math.round(0.3 * c.r + 0.59 * c.g + 0.11 * c.b) * 0.35);
      pdf.setDrawColor(grey, grey, grey);
    } else pdf.setDrawColor(c.r, c.g, c.b);
    const width = Math.max(style.minLine, Math.min(style.maxLine, (ctx.lineWidth || 1) * matrixScale(transform)));
    pdf.setLineWidth(width);
    return c.a;
  };
  const setFill = (ctx: { fillStyle: unknown }) => {
    const c = parseColor(ctx.fillStyle);
    if (style.mono) {
      // Light tints keep shapes readable on a monochrome plot without heavy toner.
      const lum = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
      const grey = lum < 90 ? 215 : lum < 170 ? 232 : 246;
      pdf.setFillColor(grey, grey, grey);
    } else {
      // Translucent symbol fills are composited over the white sheet.
      const over = (v: number) => Math.round(255 - Math.min(1, c.a) * (255 - v));
      pdf.setFillColor(over(c.r), over(c.g), over(c.b));
    }
    return c.a;
  };
  const emit = (mode: 'fill' | 'stroke') => {
    for (const path of subpaths) {
      if (path.length < 2) continue;
      pdf.moveTo(path[0].x, path[0].y);
      for (let i = 1; i < path.length; i++) pdf.lineTo(path[i].x, path[i].y);
      if (mode === 'fill') pdf.close();
    }
  };
  const visible = (alpha: number) => alpha > 0.02;

  const context = {
    fillStyle: '#000' as unknown,
    strokeStyle: '#000' as unknown,
    lineWidth: 1,
    font: '10px sans-serif',
    textAlign: 'start' as string,
    textBaseline: 'alphabetic' as string,
    save() {
      stack.push({ transform, styles: Object.fromEntries(Object.entries(this).filter(([, v]) => typeof v !== 'function')) });
    },
    restore() {
      const state = stack.pop();
      if (state) { transform = state.transform; Object.assign(this, state.styles); }
    },
    translate(x: number, y: number) { transform = multiply(transform, [1, 0, 0, 1, x, y]); },
    scale(x: number, y: number) { transform = multiply(transform, [x, 0, 0, y, 0, 0]); },
    rotate(angle: number) {
      const c = Math.cos(angle), s = Math.sin(angle);
      transform = multiply(transform, [c, s, -s, c, 0, 0]);
    },
    beginPath() { subpaths = []; current = null; last = null; },
    closePath() {
      if (current && current.length) { current.push({ ...current[0] }); }
    },
    moveTo(x: number, y: number) { begin(x, y); },
    lineTo(x: number, y: number) { to(x, y); },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      const from = last ?? { x: cx, y: cy };
      if (!current) begin(from.x, from.y);
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps, mt = 1 - t;
        to(mt * mt * from.x + 2 * mt * t * cx + t * t * x, mt * mt * from.y + 2 * mt * t * cy + t * t * y);
      }
    },
    fill() {
      if (!visible(setFill(this))) return;
      emit('fill');
      pdf.fill();
    },
    stroke() {
      if (!visible(setStroke(this))) return;
      emit('stroke');
      pdf.stroke();
    },
    fillRect(x: number, y: number, w: number, h: number) {
      const saved = subpaths;
      this.beginPath(); this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath();
      this.fill();
      subpaths = saved;
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      const saved = subpaths;
      this.beginPath(); this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath();
      this.stroke();
      subpaths = saved;
    },
    fillText(text: string, x: number, y: number) {
      const c = parseColor(this.fillStyle);
      if (!visible(c.a) || !String(text).trim()) return;
      const match = /(\d+(?:\.\d+)?)px/.exec(this.font);
      const px = match ? Number(match[1]) : 10;
      const heightMm = Math.max(1.4, Math.min(4, px * matrixScale(transform) * 0.72));
      const p = toPaper(x, y);
      const angle = -Math.atan2(transform[1], transform[0]) * 180 / Math.PI;
      pdf.setFont('helvetica', /bold/.test(this.font) ? 'bold' : 'normal');
      pdf.setFontSize(heightMm / 0.3528);
      if (style.mono) pdf.setTextColor(40, 40, 40); else pdf.setTextColor(c.r, c.g, c.b);
      const align: TextAlign = this.textAlign === 'center' ? 'center' : ['right', 'end'].includes(this.textAlign) ? 'right' : 'left';
      const baseline: TextBaseline = this.textBaseline === 'middle' ? 'middle' : this.textBaseline === 'top' ? 'top' : this.textBaseline === 'bottom' ? 'bottom' : 'alphabetic';
      drawRotatedText(pdf, String(text), p.x, p.y, { angle: Math.abs(angle) < 0.01 ? 0 : angle, align, baseline, heightMm });
    },
    arc(x: number, y: number, r: number, start: number, end: number, ccw = false) {
      this.ellipse(x, y, r, r, 0, start, end, ccw);
    },
    ellipse(x: number, y: number, rx: number, ry: number, rotation: number, start: number, end: number, ccw = false) {
      const tau = Math.PI * 2;
      let sweep = end - start;
      if (!ccw && sweep >= tau) sweep = tau;
      else if (ccw && sweep <= -tau) sweep = -tau;
      else if (ccw) { sweep %= tau; if (sweep > 0) sweep -= tau; }
      else { sweep %= tau; if (sweep < 0) sweep += tau; }
      const point = (a: number) => ({
        x: x + rx * Math.cos(a) * Math.cos(rotation) - ry * Math.sin(a) * Math.sin(rotation),
        y: y + rx * Math.cos(a) * Math.sin(rotation) + ry * Math.sin(a) * Math.cos(rotation),
      });
      const steps = Math.max(4, Math.ceil(Math.abs(sweep) / tau * 48));
      for (let i = 0; i <= steps; i++) {
        const p = point(start + sweep * i / steps);
        to(p.x, p.y);
      }
    },
  };
  return new Proxy(context, {
    get(target, key, receiver) {
      if (!(key in target)) throw new Error(`Unsupported symbol PDF command: ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  }) as unknown as CanvasRenderingContext2D;
}
