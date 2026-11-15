import { Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ComparacionParticiones } from '../comparacion-particiones/comparacion-particiones';
import { ResultadoCif } from '../core/logica/cif';
import {
  clasificar,
  contarClases,
  CORTES_POR_DEFECTO,
  CortesClasificacion,
} from '../core/logica/clasificar';
import { numero, porcentaje } from '../graficos/escala';
import { GraficoBurbujas } from '../graficos/grafico-burbujas';
import {
  GraficoLineas,
  LineaReferencia,
  MarcaPunto,
  SerieLineas,
} from '../graficos/grafico-lineas';
import { GraficoParticiones } from '../graficos/grafico-particiones';
import { TablaCif } from '../tabla-cif/tabla-cif';
import { Pestana, Pestanas } from '../ui/pestanas';

/** Ficheros que se pueden descargar desde los resultados. */
export type Descarga = 'tabla' | 'particiones' | 'configuracion';

/** Como mucho se marcan estos puntos en la línea temporal (los de más score). */
const MAX_MARCAS = 300;

/**
 * Paso 5: los resultados del CIF.
 *
 * Arriba, el resumen (cuántas anomalías y de qué clase). Debajo, pestañas con
 * la tabla, el mapa RI–II (Fig. 9), el score global frente a las particiones
 * (Fig. 8), la línea temporal, la comparación de contextos y las descargas.
 */
@Component({
  selector: 'app-resultados',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block space-y-5' },
  imports: [
    FormsModule,
    Pestanas,
    TablaCif,
    GraficoBurbujas,
    GraficoParticiones,
    GraficoLineas,
    ComparacionParticiones,
  ],
  templateUrl: './resultados.html',
})
export class Resultados {
  readonly resultado = input.required<ResultadoCif>();
  /** Cortes de la clasificación; los guarda el padre para el JSON y el CSV. */
  readonly cortes = model.required<CortesClasificacion>();
  /** Si la semilla de esta ejecución ya está fija en el formulario. */
  readonly semillaFijada = input(false);
  readonly descargar = output<Descarga>();
  readonly fijarSemilla = output<number>();

  protected readonly pestanas: Pestana[] = [
    { id: 'tabla', texto: 'Tabla' },
    { id: 'mapa', texto: 'Mapa RI–II' },
    { id: 'particiones', texto: 'Global y particiones' },
    { id: 'tiempo', texto: 'En el tiempo' },
    { id: 'comparacion', texto: 'Contextos' },
    { id: 'descargas', texto: 'Descargas' },
  ];
  protected readonly pestana = signal('tabla');
  /** Registros que enseña el gráfico de global frente a particiones. */
  protected readonly numFilasParticiones = signal(10);

  protected readonly numero = numero;
  protected readonly porcentaje = porcentaje;
  protected readonly formato3 = (y: number) => numero(y, 3);

  protected readonly clases = computed(() => contarClases(this.resultado().filas, this.cortes()));

  /** Los cortes se editan con ngModel; si se borra el campo o se sale de 0–1, no se cambia. */
  protected get corteRi(): number {
    return this.cortes().ri;
  }
  protected set corteRi(valor: number) {
    if (typeof valor === 'number' && valor >= 0 && valor <= 1) {
      this.cortes.set({ ...this.cortes(), ri: valor });
    }
  }
  protected get corteIi(): number {
    return this.cortes().ii;
  }
  protected set corteIi(valor: number) {
    if (typeof valor === 'number' && valor >= 0 && valor <= 1) {
      this.cortes.set({ ...this.cortes(), ii: valor });
    }
  }
  protected readonly cortesCambiados = computed(
    () => this.cortes().ri !== CORTES_POR_DEFECTO.ri || this.cortes().ii !== CORTES_POR_DEFECTO.ii,
  );
  protected restablecerCortes(): void {
    this.cortes.set({ ...CORTES_POR_DEFECTO });
  }

  // --- Línea temporal ---

  /** El eje x es la posición del registro; aquí se pasa a su fecha y hora. */
  protected readonly formatoMomento = (posicion: number): string => {
    const fila = this.resultado().filas[Math.round(posicion)];
    if (!fila) {
      return '';
    }
    // "2026-10-04T00:15:00.000Z" => "04/10 00:15". Si no es una fecha así, se deja como viene.
    const partes = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(fila.timestamp);
    return partes
      ? `${partes[3]}/${partes[2]} ${partes[4]}:${partes[5]}`
      : fila.timestamp.slice(0, 16);
  };

  protected readonly serieTiempo = computed<SerieLineas[]>(() => [
    {
      nombre: 'Score del IF global',
      color: 'var(--serie-1)',
      puntos: this.resultado().filas.map((f, i) => ({ x: i, y: f.score })),
    },
  ]);

  protected readonly lineaUmbral = computed<LineaReferencia[]>(() => [
    { valor: this.resultado().umbral, etiqueta: `Umbral ${this.resultado().umbral}` },
  ]);

  /** Se marcan los registros graves y las anomalías globales (los de más score si son muchos). */
  protected readonly marcasTiempo = computed<MarcaPunto[]>(() => {
    const cortes = this.cortes();
    return this.resultado()
      .filas.map((f, i) => ({ f, i, clase: clasificar(f, cortes) }))
      .filter((x) => x.clase === 'grave' || x.f.anomalia)
      .sort((a, b) => b.f.score - a.f.score)
      .slice(0, MAX_MARCAS)
      .map((x) => ({
        x: x.i,
        y: x.f.score,
        color: x.clase === 'grave' ? 'var(--estado-grave)' : 'var(--estado-limite)',
      }));
  });
}
