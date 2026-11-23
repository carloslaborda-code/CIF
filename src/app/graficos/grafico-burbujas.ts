import { Component, computed, input, signal } from '@angular/core';

import type { FilaCif } from '../core/logica/cif';
import { CortesCif, esAnomaliaCif } from '../core/logica/cortes';
import { escalaLineal, extremos } from './escala';

/** Una burbuja: un registro con II. */
interface Burbuja {
  fila: FilaCif & { ii: number };
  /** RI e II por encima de los dos cortes. */
  cif: boolean;
  x: number;
  y: number;
  radio: number;
}

/**
 * Mapa RI–II, con la forma de la Fig. 9 del artículo y los cortes que indicó el tutor:
 *   - un círculo por cada registro que es anomalía en alguna partición (los demás
 *     no tienen II y no se pueden colocar);
 *   - II en horizontal (de -0,1 a 1) y RI en vertical;
 *   - el radio es el score del IF global: un círculo grande puede quedar abajo a
 *     la izquierda y uno pequeño arriba a la derecha;
 *   - los cortes de RI e II, como líneas discontinuas: los que quedan por encima
 *     de los dos son anomalías CIF (rojos) y los demás no (verdes);
 *   - el fondo, de verde ("no anómalo") a rojo ("anómalo").
 */
@Component({
  selector: 'app-grafico-burbujas',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  templateUrl: './grafico-burbujas.html',
})
export class GraficoBurbujas {
  readonly filas = input.required<FilaCif[]>();
  readonly cortes = input.required<CortesCif>();

  protected readonly ANCHO = 640;
  protected readonly ALTO = 400;
  protected readonly margen = { arriba: 16, derecha: 20, abajo: 48, izquierda: 58 };
  /** Marcas de los ejes, como en la figura (de 0,2 en 0,2 empezando en -0,1 y 0,1). */
  protected readonly marcasX = [-0.1, 0.1, 0.3, 0.5, 0.7, 0.9];
  protected readonly marcasY = [0.1, 0.3, 0.5, 0.7, 0.9];

  protected readonly activa = signal<number | null>(null);

  protected px = escalaLineal(-0.1, 1, this.margen.izquierda, this.ANCHO - this.margen.derecha);
  protected py = escalaLineal(-0.1, 1, this.ALTO - this.margen.abajo, this.margen.arriba);

  /** Los registros que se dibujan: los que tienen II. */
  private readonly conIi = computed(() =>
    this.filas().filter((f): f is FilaCif & { ii: number } => f.ii !== null),
  );
  protected readonly numDibujados = computed(() => this.conIi().length);
  /** Cuántos no salen por no tener II (no son anomalía en ninguna partición). */
  protected readonly sinIi = computed(() => this.filas().length - this.conIi().length);

  protected readonly burbujas = computed<Burbuja[]>(() => {
    const filas = this.conIi();
    const cortes = this.cortes();
    const { min, max } = extremos(this.filas().map((f) => f.score));
    const radioDe = escalaLineal(min, max, 4, 20);
    return (
      filas
        .map((fila) => ({
          fila,
          cif: esAnomaliaCif(fila, cortes),
          x: this.px(fila.ii),
          y: this.py(fila.ri),
          radio: radioDe(fila.score),
        }))
        // Los grandes primero, para que los pequeños queden encima y se puedan señalar.
        .sort((a, b) => b.radio - a.radio)
    );
  });

  protected readonly numCif = computed(() => this.burbujas().filter((b) => b.cif).length);

  protected readonly detalle = computed(() => {
    const i = this.activa();
    return i === null ? null : (this.burbujas()[i] ?? null);
  });

  /** Filas de la tabla de datos: de mayor a menor score global. */
  protected readonly filasTabla = computed(() =>
    [...this.burbujas()].sort((a, b) => b.fila.score - a.fila.score),
  );

  /** Con el teclado: flechas para pasar de círculo en círculo. */
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
