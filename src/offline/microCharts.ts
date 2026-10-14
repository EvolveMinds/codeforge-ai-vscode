/**
 * offline/microCharts.ts — Offline SVG Micro-Visualization Engine
 *
 * Generates lightweight, zero-dependency, pure SVG inline micro-charts:
 * 1. KDE (Kernel Density Estimation) distribution sparklines for numerical data
 * 2. 1D Missingness Barcode heat-strips for null pattern diagnostics
 * 3. Categorical Diversity / Entropy stacked bars
 *
 * 100% deterministic, offline, self-contained SVG generation.
 */

export interface SparklineOptions {
  width?: number;
  height?: number;
  type?: 'kde' | 'line' | 'bars';
  strokeColor?: string;
  fillColor?: string;
  showMinMaxDots?: boolean;
}

export interface BarcodeOptions {
  width?: number;
  height?: number;
  presentColor?: string;
  missingColor?: string;
  label?: string;
}

export interface DiversityBarOptions {
  width?: number;
  height?: number;
  palette?: string[];
}

export class MicroCharts {
  private static readonly DEFAULT_PALETTE = [
    '#38bdf8', // cyan
    '#34d399', // emerald
    '#c084fc', // purple
    '#f59e0b', // amber
    '#fb7171', // rose
    '#94a3b8'  // slate / other
  ];

  /**
   * Generates a smooth Kernel Density Estimation (KDE) or mini line sparkline SVG.
   */
  static generateNumericSparkline(values: number[], options?: SparklineOptions): string {
    const width = options?.width ?? 80;
    const height = options?.height ?? 18;
    const type = options?.type ?? 'kde';
    const stroke = options?.strokeColor ?? '#38bdf8';
    const fill = options?.fillColor ?? 'rgba(56, 189, 248, 0.2)';
    const showDots = options?.showMinMaxDots ?? true;

    const validValues = (values || []).filter(v => typeof v === 'number' && !isNaN(v) && isFinite(v));
    if (validValues.length < 2) {
      // Empty or flat indicator
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;overflow:visible;">` +
        `<line x1="2" y1="${height / 2}" x2="${width - 2}" y2="${height / 2}" stroke="rgba(255,255,255,0.2)" stroke-width="1.5" stroke-dasharray="2,2"/>` +
        `</svg>`;
    }

    if (type === 'kde') {
      return this.renderKdeSvg(validValues, width, height, stroke, fill);
    } else if (type === 'bars') {
      return this.renderMiniHistogramSvg(validValues, width, height, stroke, fill);
    } else {
      return this.renderLineSparklineSvg(validValues, width, height, stroke, fill, showDots);
    }
  }

  /**
   * Computes a smoothed Gaussian Kernel Density Estimate curve.
   */
  private static renderKdeSvg(values: number[], width: number, height: number, stroke: string, fill: string): string {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;

    // Silverman's rule of thumb for bandwidth
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1 || 1);
    const stdDev = Math.sqrt(variance) || 1;
    const bandwidth = Math.max(0.9 * Math.min(stdDev, range / 1.34) * Math.pow(n, -0.2), 0.001);

    const steps = 32;
    const densityPoints: { x: number; density: number }[] = [];
    let maxDensity = 0;

    for (let i = 0; i <= steps; i++) {
      const x = min + (range * i) / steps;
      let sumKernel = 0;
      for (const val of values) {
        const u = (x - val) / bandwidth;
        sumKernel += Math.exp(-0.5 * u * u) / (Math.sqrt(2 * Math.PI) * bandwidth);
      }
      const density = sumKernel / n;
      densityPoints.push({ x, density });
      if (density > maxDensity) maxDensity = density;
    }

    const padTop = 2;
    const padBottom = 2;
    const effectiveHeight = height - padTop - padBottom;

    // Convert to SVG path coordinates
    const coords = densityPoints.map((pt, i) => {
      const sx = (i / steps) * width;
      const normalizedDensity = maxDensity > 0 ? pt.density / maxDensity : 0;
      const sy = height - padBottom - (normalizedDensity * effectiveHeight);
      return { x: sx, y: sy };
    });

    const pathD = coords.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');

    const areaD = `${pathD} L ${width} ${height - padBottom} L 0 ${height - padBottom} Z`;
    const gradId = `kde_grad_${Math.abs(Math.round(mean * 100))}_${width}`;

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;overflow:hidden;" title="KDE: [${min.toFixed(1)} → ${max.toFixed(1)}]">` +
      `<defs>` +
      `<linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="${stroke}" stop-opacity="0.35"/>` +
      `<stop offset="100%" stop-color="${stroke}" stop-opacity="0.02"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<path d="${areaD}" fill="url(#${gradId})"/>` +
      `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      `</svg>`;
  }

  /**
   * Computes a mini-histogram SVG with 8 discrete bins.
   */
  private static renderMiniHistogramSvg(values: number[], width: number, height: number, stroke: string, fill: string): string {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const binCount = 8;
    const bins = new Array(binCount).fill(0);

    for (const val of values) {
      const binIdx = Math.min(Math.floor(((val - min) / range) * binCount), binCount - 1);
      bins[binIdx]++;
    }

    const maxBin = Math.max(...bins, 1);
    const binWidth = width / binCount;
    const padTop = 2;
    const effectiveHeight = height - padTop;

    let rects = '';
    bins.forEach((cnt, idx) => {
      const barH = Math.max(1, (cnt / maxBin) * effectiveHeight);
      const x = idx * binWidth;
      const y = height - barH;
      rects += `<rect x="${(x + 0.5).toFixed(1)}" y="${y.toFixed(1)}" width="${(binWidth - 1).toFixed(1)}" height="${barH.toFixed(1)}" fill="${stroke}" fill-opacity="${cnt > 0 ? 0.8 : 0.15}" rx="1"/>`;
    });

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;overflow:hidden;">` +
      rects +
      `</svg>`;
  }

  /**
   * Computes a direct linear time-series sparkline SVG.
   */
  private static renderLineSparklineSvg(values: number[], width: number, height: number, stroke: string, fill: string, showDots: boolean): string {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const pad = 2;
    const effH = height - pad * 2;

    const coords = values.map((val, idx) => {
      const x = (idx / (values.length - 1 || 1)) * width;
      const y = height - pad - (((val - min) / range) * effH);
      return { x, y };
    });

    const pathD = coords.reduce((acc, pt, i) => {
      return i === 0 ? `M ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}` : `${acc} L ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`;
    }, '');

    let dots = '';
    if (showDots && coords.length > 0) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      dots += `<circle cx="${first.x.toFixed(1)}" cy="${first.y.toFixed(1)}" r="1.5" fill="${stroke}"/>`;
      dots += `<circle cx="${last.x.toFixed(1)}" cy="${last.y.toFixed(1)}" r="2" fill="#fff"/>`;
    }

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;overflow:hidden;">` +
      `<path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>` +
      dots +
      `</svg>`;
  }

  /**
   * Generates a 1D Missingness Barcode heat-strip SVG.
   * Visualizes exactly where null values reside across the dataset index.
   *
   * @param nullMask Array of booleans where true = missing/null, false = present.
   */
  static generateMissingnessBarcode(nullMask: boolean[], options?: BarcodeOptions): string {
    const width = options?.width ?? 70;
    const height = options?.height ?? 12;
    const presentColor = options?.presentColor ?? 'rgba(255, 255, 255, 0.12)';
    const missingColor = options?.missingColor ?? '#ef4444';

    if (!nullMask || nullMask.length === 0) {
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;">` +
        `<rect width="${width}" height="${height}" fill="${presentColor}" rx="2"/>` +
        `</svg>`;
    }

    const total = nullMask.length;
    const missingCount = nullMask.filter(Boolean).length;
    const missingPct = ((missingCount / total) * 100).toFixed(1);

    if (missingCount === 0) {
      // 100% complete — solid serene strip
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;" title="Complete: 0% missing">` +
        `<rect width="${width}" height="${height}" fill="rgba(52, 211, 153, 0.25)" stroke="rgba(52, 211, 153, 0.4)" stroke-width="0.5" rx="2"/>` +
        `</svg>`;
    }

    // Downsample/bin into width slots (e.g., 70 vertical slices)
    const slotCount = Math.min(width, Math.max(10, Math.min(total, 70)));
    const slotWidth = width / slotCount;
    let slices = '';

    for (let s = 0; s < slotCount; s++) {
      const startIdx = Math.floor((s * total) / slotCount);
      const endIdx = Math.floor(((s + 1) * total) / slotCount);
      let slotNulls = 0;
      let slotTotal = 0;

      for (let i = startIdx; i < endIdx && i < total; i++) {
        slotTotal++;
        if (nullMask[i]) slotNulls++;
      }

      const nullRatio = slotTotal > 0 ? slotNulls / slotTotal : 0;
      const x = (s * slotWidth).toFixed(1);
      const w = Math.max(0.8, slotWidth).toFixed(1);

      if (nullRatio > 0) {
        // Red/amber proportional opacity
        const opacity = Math.min(1, Math.max(0.4, nullRatio));
        slices += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${missingColor}" fill-opacity="${opacity.toFixed(2)}"/>`;
      } else {
        slices += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="${presentColor}"/>`;
      }
    }

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;border-radius:2px;overflow:hidden;" title="Missing: ${missingCount}/${total} (${missingPct}%)">` +
      slices +
      `</svg>`;
  }

  /**
   * Generates a stacked horizontal categorical diversity / entropy bar SVG.
   */
  static generateCategoricalDiversityBar(
    categories: Array<{ label: string; count: number; percentage: number }>,
    options?: DiversityBarOptions
  ): string {
    const width = options?.width ?? 70;
    const height = options?.height ?? 10;
    const palette = options?.palette ?? this.DEFAULT_PALETTE;

    if (!categories || categories.length === 0) {
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;">` +
        `<rect width="${width}" height="${height}" fill="rgba(255, 255, 255, 0.1)" rx="2"/>` +
        `</svg>`;
    }

    let rects = '';
    let currentX = 0;
    const top4 = categories.slice(0, 4);
    const sumPct = top4.reduce((acc, c) => acc + c.percentage, 0);

    top4.forEach((cat, idx) => {
      const sliceW = Math.max(1, (cat.percentage / 100) * width);
      const color = palette[idx % palette.length];
      rects += `<rect x="${currentX.toFixed(1)}" y="0" width="${sliceW.toFixed(1)}" height="${height}" fill="${color}" title="${cat.label}: ${cat.percentage.toFixed(1)}%"/>`;
      currentX += sliceW;
    });

    if (sumPct < 99 && currentX < width) {
      // Remaining 'other' tail
      const tailW = width - currentX;
      rects += `<rect x="${currentX.toFixed(1)}" y="0" width="${tailW.toFixed(1)}" height="${height}" fill="rgba(255,255,255,0.15)" title="Other: ${(100 - sumPct).toFixed(1)}%"/>`;
    }

    return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;vertical-align:middle;border-radius:2px;overflow:hidden;">` +
      rects +
      `</svg>`;
  }
}
