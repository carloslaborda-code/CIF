import { Component, computed, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ResultadoCif } from '../core/logica/cif';
import { CortesCif, esAnomaliaCif } from '../core/logica/cortes';

/**
 * Por qué columna se ordenan las filas de la tabla. Por defecto, por score del IF
 * global (de mayor a menor); por número de registro, de menor a mayor, como el CSV.
 */
type Orden = 'registro' | 'score' | 'ii' | 'ri';

/**
 * Qué registros se enseñan: todos, los que son anomalía en alguna partición
 * (RI > 0), las anomalías CIF o las anomalías globales.
 */
type Filtro = 'todos' | 'particion' | 'cif' | 'global';

/**
 * Tabla del CIF con el formato de la Tabla 5 del artículo: anomalía, ID, score
 * del IF, II, RI y una columna por partición agrupadas por contexto. Además dice
 * si cada registro es anomalía CIF (RI e II por encima de los cortes) y se puede
 * filtrar.
 *
 * Colores: solo se pintan los scores que son anomalía (por encima del umbral), de
 * amarillo (en el umbral) a rojo (el score más alto de todos los resultados). La
 * escala es la misma para el score global y las particiones, y no cambia con la
 * página ni con el filtro: rojo es siempre "anomalía fuerte".
 *
 * Se puede ver entera, como el CSV de resultados: todas las filas, por páginas
 * (pintar miles de filas de golpe dejaría el navegador colgado), y se puede ir
 * directamente a un registro.
 */
@Component({
  selector: 'app-tabla-cif',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block space-y-4' },
  imports: [FormsModule, NgTemplateOutlet],
  templateUrl: './tabla-cif.html',
})
export class TablaCif {
  readonly resultado = input.required<ResultadoCif>();
  readonly cortes = input.required<CortesCif>();

  protected readonly opcionesTamanoPagina = [50, 100, 200, 500];
  protected readonly tamanoPagina = signal(100);
  protected readonly orden = signal<Orden>('score');
  protected readonly filtro = signal<Filtro>('todos');
  /** Página que se ve (desde 0). */
  private readonly pagina = signal(0);
  /** Registro al que se ha ido con «Ir al registro», para resaltarlo. */
  protected readonly resaltado = signal<number | null>(null);
  /** Aviso de «Ir al registro» si no se encuentra. */
  protected readonly avisoIr = signal<string | null>(null);

  /** Cuántas particiones tiene cada contexto (para el colspan de la cabecera). */
  protected readonly grupos = computed(() =>
    this.resultado().contextos.map((c) => ({ nombre: c.nombre, columnas: c.particiones.length })),
  );

  /** Todas las filas, con si son anomalía CIF. */
  private readonly conCif = computed(() => {
    const cortes = this.cortes();
    return this.resultado().filas.map((f) => ({ ...f, cif: esAnomaliaCif(f, cortes) }));
  });

  /** Las filas del filtro, ordenadas por la columna elegida (a igualdad, por registro). */
  private readonly filtradas = computed(() => {
    const clave = this.orden();
    const filtro = this.filtro();
    return (
      this.conCif()
        .filter(
          (f) =>
            filtro === 'todos' ||
            (filtro === 'particion' && f.ri > 0) ||
            (filtro === 'cif' && f.cif) ||
            (filtro === 'global' && f.anomalia),
        )
        .sort((a, b) =>
          clave === 'registro'
            ? a.registro - b.registro
            : // Sin II (en blanco) va al final al ordenar por II.
              (b[clave] ?? -1) - (a[clave] ?? -1) || a.registro - b.registro,
        )
    );
  });

  protected readonly totalFiltradas = computed(() => this.filtradas().length);
  protected readonly numPaginas = computed(() =>
    Math.max(1, Math.ceil(this.totalFiltradas() / this.tamanoPagina())),
  );
  /** La página que se ve, sin pasarse de la última (por si cambian las filas). */
  protected readonly paginaActual = computed(() =>
    Math.min(this.pagina(), this.numPaginas() - 1),
  );
  /** Posición (desde 1) de la primera y la última fila que se ven. */
  protected readonly desde = computed(() => this.paginaActual() * this.tamanoPagina() + 1);
  protected readonly hasta = computed(() =>
    Math.min(this.totalFiltradas(), (this.paginaActual() + 1) * this.tamanoPagina()),
  );
  protected readonly filasVisibles = computed(() =>
    this.filtradas().slice(this.desde() - 1, this.hasta()),
  );

  protected cambiarFiltro(filtro: Filtro): void {
    this.filtro.set(filtro);
    this.volverAlPrincipio();
  }

  protected cambiarOrden(orden: Orden): void {
    this.orden.set(orden);
    this.volverAlPrincipio();
  }

  protected cambiarTamanoPagina(tamano: number): void {
    this.tamanoPagina.set(tamano);
    this.volverAlPrincipio();
  }

  protected irAPagina(pagina: number): void {
    this.pagina.set(Math.max(0, Math.min(pagina, this.numPaginas() - 1)));
  }

  private volverAlPrincipio(): void {
    this.pagina.set(0);
    this.resaltado.set(null);
    this.avisoIr.set(null);
  }

  /** Va a la página donde está el registro (con el filtro y el orden de ahora) y lo resalta. */
  protected irARegistro(valor: string | number): void {
    const registro = Number(valor);
    if (!Number.isInteger(registro)) {
      this.avisoIr.set('Escribe un número de registro.');
      return;
    }
    const i = this.filtradas().findIndex((f) => f.registro === registro);
    if (i < 0) {
      const existe = this.resultado().filas.some((f) => f.registro === registro);
      this.avisoIr.set(
        existe
          ? `El registro ${registro} no entra en el filtro elegido.`
          : `No hay registro ${registro} en estos resultados.`,
      );
      return;
    }
    this.avisoIr.set(null);
    this.resaltado.set(registro);
    this.pagina.set(Math.floor(i / this.tamanoPagina()));
  }

  /** Score más alto de todos los resultados (global y particiones): el rojo de la escala. */
  private readonly maximo = computed(() => {
    // Con un bucle y no con Math.max(...): con muchas filas, pasar todos los
    // valores como argumentos puede desbordar la pila.
    let max = -Infinity;
    for (const f of this.resultado().filas) {
      max = Math.max(max, f.score);
      for (const v of f.valores) {
        if (v !== null) max = Math.max(max, v);
      }
    }
    return max;
  });

  /**
   * Color de fondo de una celda. Sin color si el score no supera el umbral (no es
   * anomalía); si lo supera, de amarillo (en el umbral) a rojo (el más alto).
   */
  protected color(valor: number): string | null {
    const umbral = this.resultado().umbral;
    if (valor <= umbral) {
      return null;
    }
    const max = this.maximo();
    const t = max > umbral ? Math.min(1, (valor - umbral) / (max - umbral)) : 1;
    // Amarillo y rojo de la escala de Excel de la Tabla 5.
    const amarillo = [255, 235, 132];
    const rojo = [248, 105, 107];
    const canal = (i: number) => Math.round(amarillo[i] + (rojo[i] - amarillo[i]) * t);
    return `rgb(${canal(0)}, ${canal(1)}, ${canal(2)})`;
  }
}
