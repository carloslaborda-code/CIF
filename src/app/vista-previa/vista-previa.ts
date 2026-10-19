import { Component, computed, input } from '@angular/core';

import { TablaPivotada } from '../core/logica/pivotar';

/** Tabla con las primeras filas de un resultado (pivotado o fusionado). */
// La usamos en los pasos 1 y 2. No enseñamos la tabla entera porque con cientos
// de filas y más de cien columnas la página se quedaría muy pesada.
@Component({
  selector: 'app-vista-previa',
  templateUrl: './vista-previa.html',
})
export class VistaPrevia {
  /** Tabla a mostrar. */
  // Se le pasa desde el padre así: <app-vista-previa [tabla]="t" />
  readonly tabla = input.required<TablaPivotada>();
  /** Cuántas filas enseñar. */
  readonly numFilas = input(10);

  // Se recalcula sola si cambia la tabla o el número de filas.
  protected readonly filas = computed(() => this.tabla().filas.slice(0, this.numFilas()));
}
