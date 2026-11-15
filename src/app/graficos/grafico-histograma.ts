import { Component, computed, input, signal } from '@angular/core';

import type { BarraHistograma } from '../core/logica/estimar';
import { escalaLineal, extremos, marcasBonitas } from './escala';

/**
 * Histograma de los scores del IF sobre toda la tabla (Fig. 5 del artículo).
 * Cada barra tiene dos tramos: en azul los registros que han entrado en el
 * subconjunto DE y en gris el resto. Así se ve que DE sale de la zona más
 * repetida y no de los scores altos.
 */
@Component({
  selector: 'app-grafico-histograma',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  templateUrl: './grafico-histograma.html',
})
export class GraficoHistograma {
  readonly barras = input.required<BarraHistograma[]>();

  protected readonly ANCHO = 640;
  protected readonly ALTO = 260;
  protected readonly margen = { arriba: 18, derecha: 20, abajo: 44, izquierda: 54 };

  /** Barra que se está mirando (posición en la lista). */
  protected readonly activa = signal<number | null>(null);

  protected readonly marcasY = computed(() =>
    marcasBonitas(0, extremos(this.barras().map((b) => b.cuenta)).max, 5),
  );

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

  /** Rectángulos de cada barra, ya en coordenadas del dibujo. */
  protected readonly dibujo = computed(() => {
    const barras = this.barras();
    const py = this.py();
    const base = py(0);
    const hueco = (this.ANCHO - this.margen.izquierda - this.margen.derecha) / barras.length;
    // Barras finas: como mucho 24 px, y dejando 2 px de aire entre una y otra.
    const ancho = Math.max(1, Math.min(24, hueco - 2));
    return barras.map((b, i) => {
      const x = this.margen.izquierda + hueco * i + (hueco - ancho) / 2;
      const yDentro = py(b.enSubconjunto);
      const yTotal = py(b.cuenta);
      // Si la barra tiene los dos tramos, se deja una rendija entre ellos.
      const rendija = b.enSubconjunto > 0 && b.cuenta > b.enSubconjunto ? 2 : 0;
      return {
        ...b,
        x,
        ancho,
        centro: x + ancho / 2,
        dentro: { y: yDentro, alto: base - yDentro },
        fuera: { y: yTotal, alto: Math.max(0, yDentro - yTotal - rendija) },
        // Zona (más ancha que la barra) que reacciona al ratón.
        zona: { x: this.margen.izquierda + hueco * i, ancho: hueco },
      };
    });
  });

  /** Marcas del eje x: una de cada tantas barras, para que no se pisen. */
  protected readonly marcasX = computed(() => {
    const dibujo = this.dibujo();
    const salto = Math.max(1, Math.ceil(dibujo.length / 10));
    return dibujo.filter((_, i) => i % salto === 0);
  });

  protected readonly detalle = computed(() => {
    const i = this.activa();
    return i === null ? null : (this.dibujo()[i] ?? null);
  });

  /** Con el teclado: flechas para pasar de barra en barra. */
  protected alPulsar(evento: KeyboardEvent): void {
    const ultimo = this.barras().length - 1;
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
