import { Component, computed, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  columnasSinUsar,
  Contexto,
  contextoPorTipo,
  filtrarColumnas,
  nuevaParticion,
  nuevoContexto,
  Particion,
} from '../core/logica/contextos';
import type { ResumenTipo } from '../core/logica/fusionar';

/**
 * Editor de contextos y particiones (paso 3).
 *
 * Se usa así: <app-editor-contextos [columnas]="..." [tipos]="..." [(contextos)]="contextos" />
 *
 * Los nombres y pesos se editan con ngModel directamente sobre los objetos
 * (igual que los parámetros de la página principal). Cuando se añade o se
 * quita algo de la lista, se hace .set() con una lista nueva para que el
 * padre también se entere.
 */
@Component({
  selector: 'app-editor-contextos',
  imports: [FormsModule],
  templateUrl: './editor-contextos.html',
})
export class EditorContextos {
  /** Columnas de la tabla del paso 2 (las que se pueden meter en una partición). */
  readonly columnas = input.required<string[]>();
  /** Tipos del paso 2, para el botón de contexto automático (vacío si el CSV ya venía pivotado). */
  readonly tipos = input<ResumenTipo[]>([]);
  /** Alias de cada columna (aulario), para enseñarlo y poder buscar por él. */
  readonly etiquetas = input<Record<string, string>>({});
  /** Lista de contextos, enlazada en los dos sentidos con el padre. */
  readonly contextos = model.required<Contexto[]>();

  /** Partición cuyas columnas se están eligiendo (solo una abierta a la vez). */
  protected readonly editando = signal<Particion | null>(null);
  /** Texto del buscador de columnas. */
  protected readonly filtro = signal('');

  protected readonly columnasFiltradas = computed(() =>
    filtrarColumnas(this.columnas(), this.filtro(), this.etiquetas()),
  );

  protected agregarContexto(): void {
    this.contextos.set([...this.contextos(), nuevoContexto(this.contextos())]);
  }

  /** Añade un contexto con una partición por tipo (o por prefijo si no hay tipos). */
  protected agregarContextoPorTipo(): void {
    const contexto = contextoPorTipo(this.columnas(), this.tipos());
    // Si ya hay uno con ese nombre (por darle dos veces), le añadimos un número.
    const nombres = this.contextos().map((c) => c.nombre);
    let nombre = contexto.nombre;
    for (let i = 2; nombres.includes(nombre); i++) {
      nombre = `${contexto.nombre} ${i}`;
    }
    this.contextos.set([...this.contextos(), { ...contexto, nombre }]);
  }

  protected quitarContexto(contexto: Contexto): void {
    if (contexto.particiones.includes(this.editando()!)) {
      this.editando.set(null);
    }
    this.contextos.set(this.contextos().filter((c) => c !== contexto));
  }

  protected agregarParticion(contexto: Contexto): void {
    const particion = nuevaParticion(contexto);
    contexto.particiones.push(particion);
    // Abrimos directamente la nueva, que es lo siguiente que va a querer hacer el usuario.
    this.abrir(particion);
    this.contextos.set([...this.contextos()]);
  }

  protected quitarParticion(contexto: Contexto, particion: Particion): void {
    if (this.editando() === particion) {
      this.editando.set(null);
    }
    contexto.particiones = contexto.particiones.filter((p) => p !== particion);
    this.contextos.set([...this.contextos()]);
  }

  /** Abre (o cierra, si ya estaba abierta) la lista de columnas de una partición. */
  protected abrir(particion: Particion): void {
    this.editando.set(this.editando() === particion ? null : particion);
    this.filtro.set('');
  }

  protected estaMarcada(particion: Particion, columna: string): boolean {
    return particion.columnas.includes(columna);
  }

  protected alternar(particion: Particion, columna: string): void {
    const marcadas = new Set(particion.columnas);
    if (marcadas.has(columna)) {
      marcadas.delete(columna);
    } else {
      marcadas.add(columna);
    }
    this.guardarColumnas(particion, marcadas);
  }

  /** Marca (o desmarca) de golpe todas las columnas que deja ver el buscador. */
  protected marcarFiltradas(particion: Particion, marcar: boolean): void {
    const marcadas = new Set(particion.columnas);
    for (const columna of this.columnasFiltradas()) {
      if (marcar) {
        marcadas.add(columna);
      } else {
        marcadas.delete(columna);
      }
    }
    this.guardarColumnas(particion, marcadas);
  }

  /** Guarda las columnas siempre en el orden de la tabla, se marquen como se marquen. */
  private guardarColumnas(particion: Particion, marcadas: Set<string>): void {
    particion.columnas = this.columnas().filter((c) => marcadas.has(c));
  }

  protected sinUsar(contexto: Contexto): number {
    return columnasSinUsar(this.columnas(), contexto).length;
  }
}
