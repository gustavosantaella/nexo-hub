/**
 * Paleta de los graficos (reportes y panel).
 *
 * Cada tono expone las variantes que necesitan los componentes:
 *   - `stroke`: trazo del SVG (los graficos pintan con `currentColor`).
 *   - `area`: relleno translucido bajo una linea.
 *   - `fill`: color solido de barras y de los puntos de leyenda.
 *   - `soft`: barra translucida para los graficos de barras.
 *
 * Las clases Tailwind se escriben completas (nunca armadas con plantillas de
 * texto) para que el compilador las incluya en el CSS final; los tonos son
 * intermedios (500/400) para que se lean igual en tema claro y oscuro.
 */

export interface ChartColor {
  /** Nombre corto del tono (`brand`, `emerald`, …). */
  name: string;
  /** Trazo y color de texto (`currentColor` en los SVG). */
  stroke: string;
  /** Relleno translucido bajo una linea. */
  area: string;
  /** Color solido de barras y puntos de leyenda. */
  fill: string;
  /** Barra translucida de los graficos de barras. */
  soft: string;
}

export const CHART_COLORS = {
  brand: {
    name: 'brand',
    stroke: 'text-brand-500',
    area: 'fill-brand-500/15',
    fill: 'bg-brand-500',
    soft: 'bg-brand-500/80',
  },
  emerald: {
    name: 'emerald',
    stroke: 'text-emerald-500',
    area: 'fill-emerald-500/15',
    fill: 'bg-emerald-500',
    soft: 'bg-emerald-500/80',
  },
  amber: {
    name: 'amber',
    stroke: 'text-amber-500',
    area: 'fill-amber-500/15',
    fill: 'bg-amber-500',
    soft: 'bg-amber-500/80',
  },
  sky: {
    name: 'sky',
    stroke: 'text-sky-500',
    area: 'fill-sky-500/15',
    fill: 'bg-sky-500',
    soft: 'bg-sky-500/80',
  },
  rose: {
    name: 'rose',
    stroke: 'text-rose-500',
    area: 'fill-rose-500/15',
    fill: 'bg-rose-500',
    soft: 'bg-rose-500/80',
  },
  indigo: {
    name: 'indigo',
    stroke: 'text-indigo-500',
    area: 'fill-indigo-500/15',
    fill: 'bg-indigo-500',
    soft: 'bg-indigo-500/80',
  },
  teal: {
    name: 'teal',
    stroke: 'text-teal-500',
    area: 'fill-teal-500/15',
    fill: 'bg-teal-500',
    soft: 'bg-teal-500/80',
  },
  slate: {
    name: 'slate',
    stroke: 'text-slate-400',
    area: 'fill-slate-400/15',
    fill: 'bg-slate-400',
    soft: 'bg-slate-400/80',
  },
} satisfies Record<string, ChartColor>;

/** Orden de la paleta para series y categorias dinamicas. */
export const CHART_ORDER: ChartColor[] = [
  CHART_COLORS.brand,
  CHART_COLORS.emerald,
  CHART_COLORS.amber,
  CHART_COLORS.sky,
  CHART_COLORS.rose,
  CHART_COLORS.indigo,
  CHART_COLORS.teal,
  CHART_COLORS.slate,
];

/** Tono de la paleta por posicion (da la vuelta al llegar al final). */
export function chartColor(index: number): ChartColor {
  const size = CHART_ORDER.length;
  const position = ((Math.trunc(index) % size) + size) % size;
  return CHART_ORDER[position];
}

/** Tonos fijos por metodo de pago: no cambian al mover el rango de fechas. */
export const PAYMENT_METHOD_COLORS: Record<string, ChartColor> = {
  CASH: CHART_COLORS.emerald,
  CARD: CHART_COLORS.brand,
  TRANSFER: CHART_COLORS.sky,
  YAPE: CHART_COLORS.amber,
  PLIN: CHART_COLORS.teal,
  CREDIT: CHART_COLORS.rose,
  MIXED: CHART_COLORS.indigo,
};

/** Tono de un metodo de pago (los metodos nuevos caen en la paleta). */
export function paymentMethodColor(method: string, index = 0): ChartColor {
  return PAYMENT_METHOD_COLORS[method] ?? chartColor(index);
}

/** Tonos fijos de las monedas mas usadas en los locales. */
export const CURRENCY_COLORS: Record<string, ChartColor> = {
  USD: CHART_COLORS.brand,
  VES: CHART_COLORS.emerald,
  EUR: CHART_COLORS.sky,
  COP: CHART_COLORS.amber,
  USDT: CHART_COLORS.teal,
  PEN: CHART_COLORS.rose,
};

/** Tono de una moneda (las que no tienen tono propio caen en la paleta). */
export function currencyColor(code: string | null | undefined, index = 0): ChartColor {
  const key = String(code ?? '').trim().toUpperCase();
  return CURRENCY_COLORS[key] ?? chartColor(index);
}
