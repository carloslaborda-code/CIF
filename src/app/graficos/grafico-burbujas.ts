import { Component, computed, input, signal } from '@angular/core';

import type { FilaCif } from '../core/logica/cif';
import { clasificar, Clase, CortesClasificacion, NOMBRE_CLASE } from '../core/logica/clasificar';
import { escalaLineal, extremos } from './escala';

/** Un grupo de registros con el mismo RI y el mismo II (se dibujan como una sola burbuja). */
interface Burbuja {
  ri: number;
  ii: number;
  clase: Clase;
  /** Cuántos registros hay en este punto. */
  registros: number;
  scoreMaximo: number;
  /** Los registros con más score del grupo, para enseñarlos en el recuadro. */
  ejemplos: FilaCif[];
  x: number;
  y: number;
  radio: number;
}

/**
 * Mapa RI–II (Fig. 9 del artículo): II en horizontal, RI en vertical y el tamaño
 * de la burbuja según el score del IF global.
 *
 * Como RI solo puede valer k / nº de particiones y II vale 0 muchas veces, hay
 * muchos registros en el mismo punto exacto: se juntan en una burbuja y se
 * indica cuántos son. Las líneas discontinuas son los cortes de la clasificación.
 */
@Component({
  selector: 'app-grafico-burbujas',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  templateUrl: './grafico-burbujas.html',
})
export class GraficoBurbujas {
  readonly filas = input.required<FilaCif[]>();
  readonly cortes = input.required<CortesClasificacion>();

  protected readonly ANCHO = 640;
  protected readonly ALTO = 400;
  protected readonly margen = { arriba: 24, derecha: 28, abajo: 48, izquierda: 58 };
  protected readonly marcas = [0, 0.25, 0.5, 0.75, 1];
  protected readonly nombreClase = NOMBRE_CLASE;
  protected readonly color: Record<Clase, string> = {
    grave: 'var(--estado-grave)',
    limite: 'var(--estado-limite)',
    normal: 'var(--estado-normal)',
  };

  protected readonly activa = signal<number | null>(null);

  /**
   * Margen alrededor del cuadrado 0–1, en unidades de RI e II, para que las
   * burbujas de los bordes (sobre todo la del origen) no tapen los números de los ejes.
   */
  protected readonly HOLGURA = 0.05;

  protected px = escalaLineal(
    -this.HOLGURA,
    1 + this.HOLGURA,
    this.margen.izquierda,
    this.ANCHO - this.margen.derecha,
  );
  protected py = escalaLineal(
    -this.HOLGURA,
    1 + this.HOLGURA,
    this.ALTO - this.margen.abajo,
    this.margen.arriba,
  );

  protected readonly burbujas = computed<Burbuja[]>(() => {
    const filas = this.filas();
    const cortes = this.cortes();
    const { min, max } = extremos(filas.map((f) => f.score));
    const radioDe = escalaLineal(min, max, 5, 18);

    // Se agrupan los registros que caen en el mismo punto y son de la misma clase.
    // En un mismo punto pueden convivir normales y límite (los límite con RI = 0 son
    // anomalía global y los normales no): cada clase va en su propia burbuja.
    const grupos = new Map<string, { clase: Clase; filas: FilaCif[] }>();
    for (const f of filas) {
      const clase = clasificar(f, cortes);
      const clave = `${f.ri.toFixed(4)}|${f.ii.toFixed(3)}|${clase}`;
      const grupo = grupos.get(clave);
      if (grupo) grupo.filas.push(f);
      else grupos.set(clave, { clase, filas: [f] });
    }

    return (
      [...grupos.values()]
        .map(({ clase, filas: grupo }) => {
          const ordenadas = [...grupo].sort((a, b) => b.score - a.score);
          const primera = ordenadas[0];
          return {
            ri: primera.ri,
            ii: primera.ii,
            clase,
            registros: grupo.length,
            scoreMaximo: primera.score,
            ejemplos: ordenadas.slice(0, 3),
            x: this.px(primera.ii),
            y: this.py(primera.ri),
            radio: radioDe(primera.score),
          };
        })
        // Las grandes primero, para que las pequeñas queden encima y se puedan señalar.
        .sort((a, b) => b.radio - a.radio)
    );
  });

  /**
   * Índices de las burbujas cuyo "×N" se escribe. Se colocan primero las que
   * tienen más registros y se salta cualquier etiqueta que pise a otra ya puesta.
   * El número exacto de las demás sigue en el recuadro y en la tabla.
   */
  protected readonly conEtiqueta = computed(() => {
    const ALTO_TEXTO = 12;
    const ANCHO_CARACTER = 7;
    const puestas: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const elegidas = new Set<number>();
    const orden = this.burbujas()
      .map((b, i) => ({ b, i }))
      .filter(({ b }) => b.registros > 1)
      .sort((a, c) => c.b.registros - a.b.registros);
    for (const { b, i } of orden) {
      const x0 = b.x + b.radio + 4;
      const y1 = b.y - b.radio + 4;
      const caja = {
        x0,
        x1: x0 + (String(b.registros).length + 1) * ANCHO_CARACTER,
        y0: y1 - ALTO_TEXTO,
        y1,
      };
      const choca = puestas.some(
        (p) => caja.x0 < p.x1 && caja.x1 > p.x0 && caja.y0 < p.y1 && caja.y1 > p.y0,
      );
      if (!choca) {
        puestas.push(caja);
        elegidas.add(i);
      }
    }
    return elegidas;
  });

  protected readonly detalle = computed(() => {
    const i = this.activa();
    return i === null ? null : (this.burbujas()[i] ?? null);
  });

  /** Filas de la tabla de datos: los grupos, de mayor a menor score. */
  protected readonly filasTabla = computed(() =>
    [...this.burbujas()].sort((a, b) => b.scoreMaximo - a.scoreMaximo),
  );

  /** Con el teclado: flechas para pasar de burbuja en burbuja. */
  protected alPulsar(evento: KeyboardEvent): void {
    const ultimo = this.burbujas().length - 1;
    const actual = this.activa() ?? -1;
    const destinos: Record<string, number> = {
      ArrowRight: Math.min(ultimo, actual + 1),
      ArrowLeft: Math.max(0, actual - 1),
      Home: 0,
      End: ultimo,
    };
    if (evento.key in destinos) {
      evento.preventDefault();
      this.activa.set(destinos[evento.key]);
    } else if (evento.key === 'Escape') {
      this.activa.set(null);
    }
  }
}
