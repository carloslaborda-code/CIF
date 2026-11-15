import { Component, computed, ElementRef, input, signal, viewChild } from '@angular/core';

import { escalaLineal, extremos, marcasBonitas } from './escala';

/** Una línea del gráfico. Todas las series deben tener los mismos valores de x. */
export interface SerieLineas {
  nombre: string;
  /** Color CSS (por ejemplo 'var(--serie-1)'). */
  color: string;
  puntos: { x: number; y: number }[];
}

/** Línea recta de referencia (un umbral, el valor propuesto...). */
export interface LineaReferencia {
  valor: number;
  etiqueta: string;
}

/** Punto suelto que se marca encima de las líneas (por ejemplo una anomalía). */
export interface MarcaPunto {
  x: number;
  y: number;
  color: string;
}

/**
 * Gráfico de líneas en SVG, hecho a mano (sin librerías).
 *
 * Se usa para las métricas por número de árboles (Fig. 6), el umbral por
 * contaminación (Fig. 7) y la línea temporal del score.
 *
 * Accesibilidad: al pasar el ratón, o con las flechas del teclado si tiene el
 * foco, enseña los valores del punto; y debajo hay una tabla con los mismos
 * datos para quien no pueda ver el dibujo.
 */
@Component({
  selector: 'app-grafico-lineas',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  templateUrl: './grafico-lineas.html',
})
export class GraficoLineas {
  /** Frase que describe el gráfico (la leen los lectores de pantalla). */
  readonly descripcion = input.required<string>();
  readonly series = input.required<SerieLineas[]>();
  readonly etiquetaX = input('');
  readonly etiquetaY = input('');
  /** Cómo escribir un valor de x y de y (en los ejes, el recuadro y la tabla). */
  readonly formatoX = input<(x: number) => string>((x) => String(x));
  readonly formatoY = input<(y: number) => string>((y) => y.toFixed(2));
  /** Líneas horizontales (valor en el eje y) y verticales (valor en el eje x). */
  readonly lineasH = input<LineaReferencia[]>([]);
  readonly lineasV = input<LineaReferencia[]>([]);
  readonly marcas = input<MarcaPunto[]>([]);
  /** Límites del eje y. Si no se dan, se ajustan a los datos. */
  readonly minY = input<number | null>(null);
  readonly maxY = input<number | null>(null);
  readonly alto = input(260);
  /** Pinta un punto en cada dato (solo conviene con pocos datos). */
  readonly conPuntos = input(false);
  /** Filas que enseña la tabla de datos como mucho. */
  readonly maxFilasTabla = input(200);

  protected readonly ANCHO = 640;
  protected readonly margen = { arriba: 18, derecha: 20, abajo: 44, izquierda: 54 };

  private readonly svg = viewChild.required<ElementRef<SVGSVGElement>>('svg');
  /** Posición (en la lista de valores de x) del punto que se está mirando. */
  protected readonly activo = signal<number | null>(null);

  /** Valores de x, sacados de la primera serie. */
  protected readonly xs = computed(() => (this.series()[0]?.puntos ?? []).map((p) => p.x));

  protected readonly marcasX = computed(() => {
    const { min, max } = extremos(this.xs());
    return marcasBonitas(min, max, 6).filter((m) => m >= min && m <= max);
  });

  protected readonly marcasY = computed(() => {
    const valores = [
      ...this.series().flatMap((s) => s.puntos.map((p) => p.y)),
      ...this.lineasH().map((l) => l.valor),
      ...this.marcas().map((m) => m.y),
    ];
    const { min, max } = extremos(valores);
    return marcasBonitas(this.minY() ?? min, this.maxY() ?? max, 5);
  });

  protected readonly px = computed(() => {
    const { min, max } = extremos(this.xs());
    return escalaLineal(min, max, this.margen.izquierda, this.ANCHO - this.margen.derecha);
  });

  protected readonly py = computed(() => {
    const marcas = this.marcasY();
    return escalaLineal(
      marcas[0],
      marcas[marcas.length - 1],
      this.alto() - this.margen.abajo,
      this.margen.arriba,
    );
  });

  /** El trazo de cada serie, ya en coordenadas del dibujo. */
  protected readonly trazos = computed(() => {
    const px = this.px();
    const py = this.py();
    return this.series().map((s) => ({
      ...s,
      d: s.puntos
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.x).toFixed(1)} ${py(p.y).toFixed(1)}`)
        .join(''),
    }));
  });

  /** Lo que enseña el recuadro del punto que se está mirando. */
  protected readonly detalle = computed(() => {
    const i = this.activo();
    if (i === null || i >= this.xs().length) {
      return null;
    }
    const x = this.xs()[i];
    const posicion = this.px()(x);
    return {
      x,
      posicion,
      // A partir de la mitad, el recuadro se pone a la izquierda del punto para no salirse.
      aLaIzquierda: posicion > this.ANCHO * 0.6,
      valores: this.series().map((s) => ({ nombre: s.nombre, color: s.color, y: s.puntos[i].y })),
    };
  });

  /** Filas de la tabla de datos (una por valor de x). */
  protected readonly filasTabla = computed(() =>
    this.xs()
      .slice(0, this.maxFilasTabla())
      .map((x, i) => ({ x, valores: this.series().map((s) => s.puntos[i].y) })),
  );

  /** Al mover el ratón: busca el punto más cercano en horizontal. */
  protected alMover(evento: PointerEvent): void {
    const caja = this.svg().nativeElement.getBoundingClientRect();
    const xDibujo = ((evento.clientX - caja.left) / caja.width) * this.ANCHO;
    const xs = this.xs();
    if (xs.length === 0) {
      return;
    }
    const px = this.px();
    // Búsqueda binaria: los x van ordenados y puede haber decenas de miles.
    let a = 0;
    let b = xs.length - 1;
    while (b - a > 1) {
      const medio = (a + b) >> 1;
      if (px(xs[medio]) < xDibujo) a = medio;
      else b = medio;
    }
    this.activo.set(Math.abs(px(xs[a]) - xDibujo) <= Math.abs(px(xs[b]) - xDibujo) ? a : b);
  }

  /** Con el teclado: flechas para moverse por los puntos, Inicio y Fin para ir a los extremos. */
  protected alPulsar(evento: KeyboardEvent): void {
    const ultimo = this.xs().length - 1;
    if (ultimo < 0) {
      return;
    }
    const actual = this.activo() ?? -1;
    const destinos: Record<string, number> = {
      ArrowRight: Math.min(ultimo, actual + 1),
      ArrowLeft: Math.max(0, actual - 1),
      Home: 0,
      End: ultimo,
    };
    if (evento.key in destinos) {
      evento.preventDefault();
      this.activo.set(destinos[evento.key]);
    } else if (evento.key === 'Escape') {
      this.activo.set(null);
    }
  }
}
