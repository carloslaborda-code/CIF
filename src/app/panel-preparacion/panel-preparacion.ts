import { Component, computed, input, linkedSignal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  Diccionario,
  leerDiccionarioCsv,
  OPCIONES_EXTRACCION,
  Operacion,
  validarOperaciones,
} from '../core/logica/preparar';

/** Lo que enseña el panel del resultado de la última preparación. */
export interface ResumenPreparacion {
  columnasNuevas: string[];
  columnasCodificadas: string[];
  diccionario: Diccionario;
  valoresNuevos: number;
}

/** Nombre de cada tipo de operación para enseñarlo. */
const NOMBRE_OPERACION: Record<Operacion['tipo'], string> = {
  extraer: 'Extraer',
  combinar: 'Combinar',
  eliminar: 'Eliminar',
  anadir: 'Añadir',
};

/**
 * Procesado de características (3.1.1) y codificación (3.1.2) del artículo.
 *
 * Se usa así:
 *   <app-panel-preparacion [columnaTimestamp]="..." [columnas]="..." [operaciones]="..."
 *     [delArticulo]="..." [sinFecha]="..." [resumen]="..." [diccionarioEntrada]="..."
 *     (aplicar)="..." (restablecer)="..." (cargarDiccionario)="..." (descargarDiccionario)="..." />
 *
 * Las operaciones se editan en un borrador y solo se aplican (y se rehace la
 * tabla) al pulsar el botón, igual que el filtro.
 */
@Component({
  selector: 'app-panel-preparacion',
  host: { class: 'block space-y-5' },
  imports: [FormsModule],
  templateUrl: './panel-preparacion.html',
})
export class PanelPreparacion {
  /** Nombre de la columna del timestamp (se puede usar como origen). */
  readonly columnaTimestamp = input.required<string>();
  /** Columnas de la tabla antes del procesado. */
  readonly columnas = input.required<string[]>();
  /** Operaciones pedidas ahora mismo. */
  readonly operaciones = input.required<Operacion[]>();
  /** true si son las del experimento del artículo (no se han cambiado). */
  readonly delArticulo = input(false);
  /** true si la tabla no tiene fecha: entonces por defecto no hay operaciones. */
  readonly sinFecha = input(false);
  /** Resultado de la última preparación, o null si dio error. */
  readonly resumen = input<ResumenPreparacion | null>(null);
  /** Diccionario con el que empieza la codificación. */
  readonly diccionarioEntrada = input.required<Diccionario>();

  readonly aplicar = output<Operacion[]>();
  readonly restablecer = output<void>();
  readonly cargarDiccionario = output<Diccionario>();
  readonly descargarDiccionario = output<void>();

  protected readonly opcionesExtraccion = OPCIONES_EXTRACCION;
  protected readonly nombreOperacion = NOMBRE_OPERACION;
  /** Cuántas columnas codificadas se enseñan por su nombre antes de resumir. */
  protected readonly maxNombres = 12;

  /** Copia editable de las operaciones; se reinicia cuando cambian las aplicadas. */
  protected readonly borrador = linkedSignal<Operacion[]>(() =>
    structuredClone(this.operaciones()),
  );

  /** Error del borrador, o null si se puede aplicar. */
  protected error(): string | null {
    return validarOperaciones(this.borrador(), this.columnaTimestamp(), this.columnas());
  }

  /** true si el borrador no es lo aplicado. */
  protected pendiente(): boolean {
    return JSON.stringify(this.borrador()) !== JSON.stringify(this.operaciones());
  }

  /**
   * Columnas que puede usar la operación i: el timestamp, las de la tabla y las
   * que han creado las anteriores, menos las que han eliminado.
   */
  protected columnasEn(i: number, conTimestamp = true): string[] {
    const lista = [...this.columnas()];
    for (const o of this.borrador().slice(0, i)) {
      if (o.tipo === 'eliminar') {
        const j = lista.indexOf(o.columna);
        if (j >= 0) lista.splice(j, 1);
      } else if (o.destino.trim() !== '') {
        lista.push(o.destino.trim());
      }
    }
    return conTimestamp ? [this.columnaTimestamp(), ...lista] : lista;
  }

  protected agregar(tipo: Operacion['tipo']): void {
    const i = this.borrador().length;
    const columnas = this.columnasEn(i, false);
    const primera = columnas[0] ?? '';
    const nueva: Operacion =
      tipo === 'extraer'
        ? { tipo, origen: this.columnaTimestamp(), destino: '', op: 'dia' }
        : tipo === 'combinar'
          ? { tipo, a: primera, b: columnas[1] ?? primera, destino: '' }
          : tipo === 'eliminar'
            ? { tipo, columna: primera }
            : { tipo, destino: '', valor: '0' };
    this.borrador.update((ops) => [...ops, nueva]);
  }

  protected quitar(i: number): void {
    this.borrador.update((ops) => ops.filter((_, j) => j !== i));
  }

  protected mover(i: number, salto: -1 | 1): void {
    this.borrador.update((ops) => {
      const copia = [...ops];
      [copia[i], copia[i + salto]] = [copia[i + salto], copia[i]];
      return copia;
    });
  }

  /** Al cambiar a "Trozo de texto" hacen falta inicio y longitud. */
  protected alCambiarExtraccion(o: Operacion): void {
    if (o.tipo === 'extraer' && o.op === 'subcadena') {
      o.inicio ??= 1;
      o.longitud ??= 1;
    }
    this.refrescar();
  }

  /** ngModel cambia el objeto por dentro; con esto el signal se entera. */
  protected refrescar(): void {
    this.borrador.update((ops) => [...ops]);
  }

  protected alAplicar(): void {
    if (this.error() === null) {
      this.aplicar.emit(structuredClone(this.borrador()));
    }
  }

  // -- Codificación ---------------------------------------------------------

  protected readonly valoresEntrada = computed(() => Object.keys(this.diccionarioEntrada()).length);
  protected readonly valoresDiccionario = computed(
    () => Object.keys(this.resumen()?.diccionario ?? {}).length,
  );
  /** Error al leer un diccionario. */
  protected errorDiccionario: string | null = null;

  protected async alElegirDiccionario(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const fichero = input.files?.[0];
    input.value = '';
    if (!fichero) {
      return;
    }
    try {
      this.errorDiccionario = null;
      this.cargarDiccionario.emit(leerDiccionarioCsv(await fichero.text()));
    } catch (e) {
      this.errorDiccionario = e instanceof Error ? e.message : String(e);
    }
  }
}
