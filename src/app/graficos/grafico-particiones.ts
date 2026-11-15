import { Component, computed, input, signal } from '@angular/core';

import { ResultadoCif } from '../core/logica/cif';
import { escalaLineal, extremos, marcasBonitas } from './escala';

/** Colores de las particiones, en un orden comprobado para daltonismo. */
const COLORES = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#6250d6',
  '#e34948',
];

/**
 * Fig. 8 del artículo, con sus dos paneles, para los registros con más score:
 *   a) el score de cada registro en el IF global,
 *   b) su valor en cada partición (el score si supera el umbral y 0 si no,
 *      los mismos valores que la tabla).
 *
 * Los dos paneles comparten el orden de los registros y la escala vertical, para
 * comparar de un vistazo lo global con lo contextual.
 */
@Component({
  selector: 'app-grafico-particiones',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block space-y-4' },
  templateUrl: './grafico-particiones.html',
})
export class GraficoParticiones {
  readonly resultado = input.required<ResultadoCif>();
  /** Cuántos registros enseñar (los de más score global). */
  readonly numFilas = input(10);

  protected readonly ANCHO = 640;
  protected readonly ALTO = 230;
  protected readonly margen = { arriba: 18, derecha: 20, abajo: 44, izquierda: 54 };

  /** Registro que se está mirando (posición en la lista), el mismo en los dos paneles. */
  protected readonly activa = signal<number | null>(null);

  protected readonly filas = computed(() =>
    [...this.resultado().filas].sort((a, b) => b.score - a.score).slice(0, this.numFilas()),
  );

  /** Nombre y color de cada partición. Con más de 8 particiones los colores se repiten. */
  protected readonly particiones = computed(() =>
    this.resultado().particiones.map((p, k) => ({
      nombre: `${p.contexto} / ${p.particion}`,
      color: COLORES[k % COLORES.length],
    })),
  );

  protected readonly marcasY = computed(() => {
    const valores = this.filas().flatMap((f) => [f.score, ...f.valores]);
    return marcasBonitas(0, extremos([...valores, this.resultado().umbral]).max, 5);
  });

  private readonly py = computed(() => {
    const marcas = this.marcasY();
    return escalaLineal(
      0,
      marcas[marcas.length - 1],
      this.ALTO - this.margen.abajo,
      this.margen.arriba,
    );
  });

  protected yDe(valor: number): number {
    return this.py()(valor);
  }

  /** Posición y barras de cada registro en los dos paneles. */
  protected readonly dibujo = computed(() => {
    const py = this.py();
    const base = py(0);
    const filas = this.filas();
    const particiones = this.particiones();
    const hueco = (this.ANCHO - this.margen.izquierda - this.margen.derecha) / filas.length;
    // Panel a: una barra por registro, de 24 px como mucho.
    const anchoGlobal = Math.min(24, hueco * 0.6);
    // Panel b: una barra por partición dentro del hueco del registro.
    const anchoGrupo = hueco * 0.8;
    const paso = anchoGrupo / Math.max(1, particiones.length);
    const anchoBarra = Math.max(1, Math.min(14, paso - 1));
    return filas.map((fila, i) => {
      const x = this.margen.izquierda + hueco * i;
      const centro = x + hueco / 2;
      return {
        fila,
        centro,
        zona: { x, ancho: hueco },
        global: {
          x: centro - anchoGlobal / 2,
          ancho: anchoGlobal,
          y: py(fila.score),
          alto: base - py(fila.score),
        },
        barras: fila.valores.map((valor, k) => ({
          x: centro - anchoGrupo / 2 + paso * k + (paso - anchoBarra) / 2,
          ancho: anchoBarra,
          y: py(valor),
          alto: base - py(valor),
          color: particiones[k].color,
        })),
      };
    });
  });

  protected readonly detalle = computed(() => {
    const i = this.activa();
    return i === null ? null : (this.dibujo()[i] ?? null);
  });

  /** Con el teclado: flechas para pasar de registro en registro. */
  protected alPulsar(evento: KeyboardEvent): void {
    const ultimo = this.filas().length - 1;
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
