import { Component, computed, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ResultadoCif } from '../core/logica/cif';
import { CortesCif, esAnomaliaCif } from '../core/logica/cortes';
import { extremos } from '../graficos/escala';

/** Por qué columna se ordenan las filas de la tabla. */
type Orden = 'score' | 'ii' | 'ri';

/**
 * Qué registros se enseñan: todos, los que son anomalía en alguna partición
 * (RI > 0), las anomalías CIF o las anomalías globales.
 */
type Filtro = 'todos' | 'particion' | 'cif' | 'global';

/** Mínimo y máximo de los valores que se pintan, para la escala de color. */
interface Escala {
  min: number;
  max: number;
}

/**
 * Tabla del CIF con el formato de la Tabla 5 del artículo: anomalía, ID, score
 * del IF, II, RI y una columna por partición agrupadas por contexto, coloreadas
 * de verde (más bajo) a rojo (más alto). Además dice si cada registro es anomalía
 * CIF (RI e II por encima de los cortes) y se puede filtrar.
 */
@Component({
  selector: 'app-tabla-cif',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block space-y-4' },
  imports: [FormsModule],
  templateUrl: './tabla-cif.html',
})
export class TablaCif {
  readonly resultado = input.required<ResultadoCif>();
  readonly cortes = input.required<CortesCif>();

  protected readonly opcionesNumFilas = [10, 20, 50, 100];
  protected readonly numFilas = signal(10);
  protected readonly orden = signal<Orden>('score');
  protected readonly filtro = signal<Filtro>('todos');

  /** Cuántas particiones tiene cada contexto (para el colspan de la cabecera). */
  protected readonly grupos = computed(() =>
    this.resultado().contextos.map((c) => ({ nombre: c.nombre, columnas: c.particiones.length })),
  );

  /** Todas las filas, con si son anomalía CIF. */
  private readonly conCif = computed(() => {
    const cortes = this.cortes();
    return this.resultado().filas.map((f) => ({ ...f, cif: esAnomaliaCif(f, cortes) }));
  });

  /** Las filas del filtro, ordenadas por la columna elegida (a igualdad, por score global). */
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
        // Sin II (en blanco) va al final al ordenar por II.
        .sort((a, b) => (b[clave] ?? -1) - (a[clave] ?? -1) || b.score - a.score)
    );
  });

  protected readonly totalFiltradas = computed(() => this.filtradas().length);
  protected readonly filasVisibles = computed(() => this.filtradas().slice(0, this.numFilas()));

  // Igual que en Excel, cada bloque tiene su propia escala de color:
  // la columna del score global por un lado y las particiones por otro.
  protected readonly escalaScore = computed(() =>
    extremos(this.filasVisibles().map((f) => f.score)),
  );
  protected readonly escalaParticiones = computed(() =>
    extremos(
      this.filasVisibles()
        .flatMap((f) => f.valores)
        .filter((v): v is number => v !== null),
    ),
  );

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
}
