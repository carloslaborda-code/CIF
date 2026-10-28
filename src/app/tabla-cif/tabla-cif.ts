import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { FilaCif, ResultadoCif } from '../core/logica/cif';

/** Por qué columna se ordenan las filas de la tabla. */
type Orden = 'score' | 'ii' | 'ri';

/** Mínimo y máximo de los valores que se pintan, para la escala de color. */
interface Escala {
  min: number;
  max: number;
}

/** Resumen de un contexto entero, para compararlos entre sí. */
interface ResumenContexto {
  nombre: string;
  numParticiones: number;
  /** Filas que son anomalía en al menos una partición del contexto. */
  filasAfectadas: number;
  /** De las anomalías globales, cuántas salen en al menos una partición del contexto. */
  anomaliasGlobalesVistas: number;
}

/**
 * Tabla del CIF con el formato de la Tabla 5 del artículo: An., ID, IF Sc, II, RI
 * y una columna por partición agrupadas por contexto, coloreadas de verde
 * (más bajo) a rojo (más alto). Debajo, la comparación de contextos y particiones.
 */
@Component({
  selector: 'app-tabla-cif',
  imports: [FormsModule],
  templateUrl: './tabla-cif.html',
})
export class TablaCif {
  readonly resultado = input.required<ResultadoCif>();

  protected readonly opcionesNumFilas = [10, 20, 50, 100];
  protected readonly numFilas = signal(10);
  protected readonly orden = signal<Orden>('score');

  /** Cuántas particiones tiene cada contexto (para el colspan de la cabecera). */
  protected readonly grupos = computed(() =>
    this.resultado().contextos.map((c) => ({ nombre: c.nombre, columnas: c.particiones.length })),
  );

  /** Las filas con el valor más alto de la columna elegida (a igualdad, por score global). */
  protected readonly filasVisibles = computed(() => {
    const clave = this.orden();
    return [...this.resultado().filas]
      .sort((a, b) => b[clave] - a[clave] || b.score - a.score)
      .slice(0, this.numFilas());
  });

  // Igual que en Excel, cada bloque tiene su propia escala de color:
  // la columna del score global por un lado y las particiones por otro.
  protected readonly escalaScore = computed(() => escala(this.filasVisibles().map((f) => f.score)));
  protected readonly escalaParticiones = computed(() =>
    escala(
      this.filasVisibles()
        .flatMap((f) => f.valores)
        .filter((v) => v > 0),
    ),
  );

  protected readonly resumenContextos = computed<ResumenContexto[]>(() => {
    const r = this.resultado();
    let inicio = 0;
    return r.contextos.map((c) => {
      // Las particiones de este contexto ocupan estas posiciones de `valores`.
      const fin = inicio + c.particiones.length;
      const afectada = (f: FilaCif) => f.valores.slice(inicio, fin).some((v) => v > 0);
      const resumen = {
        nombre: c.nombre,
        numParticiones: c.particiones.length,
        filasAfectadas: r.filas.filter(afectada).length,
        anomaliasGlobalesVistas: r.filas.filter((f) => f.anomalia && afectada(f)).length,
      };
      inicio = fin;
      return resumen;
    });
  });

  /** Color de fondo de una celda: verde, amarillo o rojo según su sitio en la escala. */
  protected color(valor: number, e: Escala): string {
    // Si todos los valores son iguales no hay escala; los pintamos en amarillo.
    const t = e.max > e.min ? (valor - e.min) / (e.max - e.min) : 0.5;
    // Los mismos tres colores que la escala de Excel de la Tabla 5.
    const verde = [99, 190, 123];
    const amarillo = [255, 235, 132];
    const rojo = [248, 105, 107];
    const [desde, hasta, u] = t < 0.5 ? [verde, amarillo, t * 2] : [amarillo, rojo, (t - 0.5) * 2];
    const canal = (i: number) => Math.round(desde[i] + (hasta[i] - desde[i]) * u);
    return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`;
  }

  protected porcentaje(parte: number): string {
    return ((parte / this.resultado().filas.length) * 100).toFixed(1);
  }
}

/** Mínimo y máximo con un bucle (Math.min(...lista) falla con listas muy largas). */
function escala(valores: number[]): Escala {
  let min = Infinity;
  let max = -Infinity;
  for (const v of valores) {
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { min, max };
}
