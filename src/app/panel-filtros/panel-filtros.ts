import { Component, computed, input, linkedSignal, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  aplicarFiltro,
  CampoFiltro,
  filtroDeSeleccion,
  FiltroLecturas,
  OpcionFiltro,
  opcionesDeFiltro,
} from '../core/logica/filtrar';
import type { Lectura } from '../core/logica/pivotar';

/** Lo marcado en cada campo mientras se edita (antes de pulsar Aplicar). */
type Seleccion = Record<CampoFiltro, Set<string>>;

/**
 * Filtro de lecturas por tipo, aulario y sensor.
 *
 * Se usa así: <app-panel-filtros [lecturas]="..." [filtro]="..." (aplicar)="..." />
 *
 * Las casillas se pueden cambiar libremente; el filtro solo se aplica (y se
 * vuelve a pivotar) al pulsar el botón, porque con muchas lecturas tarda un poco.
 */
@Component({
  selector: 'app-panel-filtros',
  imports: [FormsModule],
  templateUrl: './panel-filtros.html',
})
export class PanelFiltros {
  /** Todas las lecturas leídas del CSV, sin filtrar. */
  readonly lecturas = input.required<Lectura[]>();
  /** Filtro aplicado ahora mismo. */
  readonly filtro = input.required<FiltroLecturas>();
  /** Se emite al pulsar "Aplicar filtros". */
  readonly aplicar = output<FiltroLecturas>();

  /** Título y explicación de cada lista. */
  protected readonly campos: { campo: CampoFiltro; titulo: string }[] = [
    { campo: 'tipos', titulo: 'Tipo (name)' },
    { campo: 'alias', titulo: 'Aulario (alias)' },
    { campo: 'ids', titulo: 'Sensor (uid)' },
  ];

  protected readonly opciones = computed(() => opcionesDeFiltro(this.lecturas()));

  /**
   * Lo marcado. linkedSignal se reinicia solo cuando cambian las lecturas o el
   * filtro aplicado, y mientras tanto se puede modificar con .set().
   */
  protected readonly seleccion = linkedSignal<Seleccion>(() => {
    const opciones = this.opciones();
    const filtro = this.filtro();
    // null = todos marcados
    const marcar = (campo: CampoFiltro) =>
      new Set(filtro[campo] ?? opciones[campo].map((o) => o.valor));
    return { tipos: marcar('tipos'), ids: marcar('ids'), alias: marcar('alias') };
  });

  /** Texto del buscador de cada lista. */
  protected readonly busqueda = signal<Record<CampoFiltro, string>>({
    tipos: '',
    ids: '',
    alias: '',
  });

  /** Filtro que saldría de lo marcado ahora (si está todo marcado, null). */
  protected readonly filtroMarcado = computed<FiltroLecturas>(() =>
    filtroDeSeleccion(this.opciones(), this.seleccion()),
  );

  /** Cuántas lecturas y sensores quedarían con lo marcado. */
  protected readonly resumen = computed(() => {
    const quedan = aplicarFiltro(this.lecturas(), this.filtroMarcado());
    return { lecturas: quedan.length, sensores: new Set(quedan.map((l) => l.id)).size };
  });

  /** true si lo marcado no es lo que está aplicado. */
  protected readonly hayCambios = computed(
    () => JSON.stringify(this.filtroMarcado()) !== JSON.stringify(this.filtro()),
  );

  /** Opciones de una lista que deja ver el buscador (busca en el valor y en el detalle). */
  protected visibles(campo: CampoFiltro): OpcionFiltro[] {
    const texto = this.busqueda()[campo].trim().toLowerCase();
    const opciones = this.opciones()[campo];
    if (texto === '') {
      return opciones;
    }
    return opciones.filter(
      (o) => o.valor.toLowerCase().includes(texto) || o.detalle.toLowerCase().includes(texto),
    );
  }

  protected buscar(campo: CampoFiltro, texto: string): void {
    this.busqueda.set({ ...this.busqueda(), [campo]: texto });
  }

  protected alternar(campo: CampoFiltro, valor: string): void {
    const marcados = new Set(this.seleccion()[campo]);
    if (marcados.has(valor)) {
      marcados.delete(valor);
    } else {
      marcados.add(valor);
    }
    // Objeto nuevo para que los computed se enteren del cambio.
    this.seleccion.set({ ...this.seleccion(), [campo]: marcados });
  }

  /** Marca (o desmarca) de golpe las opciones que deja ver el buscador. */
  protected marcarVisibles(campo: CampoFiltro, marcar: boolean): void {
    const marcados = new Set(this.seleccion()[campo]);
    for (const o of this.visibles(campo)) {
      if (marcar) {
        marcados.add(o.valor);
      } else {
        marcados.delete(o.valor);
      }
    }
    this.seleccion.set({ ...this.seleccion(), [campo]: marcados });
  }

  /** Vuelve a marcar todo (quita el filtro, pero sin aplicarlo todavía). */
  protected marcarTodo(): void {
    const opciones = this.opciones();
    const todos = (campo: CampoFiltro) => new Set(opciones[campo].map((o) => o.valor));
    this.seleccion.set({ tipos: todos('tipos'), ids: todos('ids'), alias: todos('alias') });
  }
}
