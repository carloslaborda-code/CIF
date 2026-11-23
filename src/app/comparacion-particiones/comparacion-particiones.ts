import { Component, computed, input } from '@angular/core';

import { FilaCif, ResultadoCif } from '../core/logica/cif';

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
 * Dos tablas para comparar contextos y particiones entre sí: cuántas anomalías
 * ve cada uno, su score medio y máximo, y qué contexto detecta las anomalías globales.
 */
@Component({
  selector: 'app-comparacion-particiones',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  templateUrl: './comparacion-particiones.html',
})
export class ComparacionParticiones {
  readonly resultado = input.required<ResultadoCif>();

  protected readonly resumenContextos = computed<ResumenContexto[]>(() => {
    const r = this.resultado();
    let inicio = 0;
    return r.contextos.map((c) => {
      // Las particiones de este contexto ocupan estas posiciones de `valores`.
      const desde = inicio;
      const hasta = inicio + c.particiones.length;
      const afectada = (f: FilaCif) => f.valores.slice(desde, hasta).some((v) => v !== null);
      inicio = hasta;
      return {
        nombre: c.nombre,
        numParticiones: c.particiones.length,
        filasAfectadas: r.filas.filter(afectada).length,
        anomaliasGlobalesVistas: r.filas.filter((f) => f.anomalia && afectada(f)).length,
      };
    });
  });

  protected porcentaje(parte: number): string {
    return ((parte / this.resultado().filas.length) * 100).toFixed(1).replace('.', ',');
  }
}
