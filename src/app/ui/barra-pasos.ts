import { Component, input, output } from '@angular/core';

/** Un paso del asistente. */
export interface Paso {
  numero: number;
  titulo: string;
  /** Frase corta con lo que ya hay hecho en el paso ("733 filas", "2 contextos"...). */
  resumen: string;
  /** Hecho: ya tiene lo que necesita. */
  hecho: boolean;
  /** Bloqueado: todavía no se puede entrar (falta algo de un paso anterior). */
  bloqueado: boolean;
}

/**
 * Barra con los pasos del asistente. Enseña en cuál se está, cuáles están
 * hechos y deja saltar a cualquiera que no esté bloqueado.
 *
 * Es una lista de botones normales dentro de un <nav>: se recorre con el
 * tabulador y el paso actual lleva aria-current="step" para los lectores de pantalla.
 */
@Component({
  selector: 'app-barra-pasos',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  templateUrl: './barra-pasos.html',
})
export class BarraPasos {
  readonly pasos = input.required<Paso[]>();
  /** Número del paso que se está viendo. */
  readonly actual = input.required<number>();
  /** Avisa al padre de que se quiere ir a un paso. */
  readonly ir = output<number>();
}
