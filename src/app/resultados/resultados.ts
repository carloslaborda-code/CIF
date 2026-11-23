import { Component, computed, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ComparacionParticiones } from '../comparacion-particiones/comparacion-particiones';
import { ResultadoCif } from '../core/logica/cif';
import { cortesPorDefecto, CortesCif, esAnomaliaCif } from '../core/logica/cortes';
import { numero, porcentaje } from '../graficos/escala';
import { GraficoBurbujas } from '../graficos/grafico-burbujas';
import {
  GraficoLineas,
  LineaReferencia,
  MarcaPunto,
  SerieLineas,
} from '../graficos/grafico-lineas';
import { TablaCif } from '../tabla-cif/tabla-cif';
import { Pestana, Pestanas } from '../ui/pestanas';

/** Ficheros que se pueden descargar desde los resultados. */
export type Descarga = 'tabla' | 'particiones' | 'configuracion';

/** Como mucho se marcan estos puntos en la línea temporal (los de más score). */
const MAX_MARCAS = 300;

/**
 * Paso 5: los resultados del CIF.
 *
 * Arriba, el resumen (anomalías globales y anomalías CIF). Debajo, pestañas con
 * la tabla, el mapa RI–II (Fig. 9), la línea temporal, la comparación de
 * contextos y las descargas.
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
    GraficoLineas,
    ComparacionParticiones,
  ],
  templateUrl: './resultados.html',
})
export class Resultados {
  readonly resultado = input.required<ResultadoCif>();
  /** Cortes de RI e II; los guarda el padre para el JSON y el CSV. */
  readonly cortes = model.required<CortesCif>();
  /** Si la semilla de esta ejecución ya está fija en el formulario. */
  readonly semillaFijada = input(false);
  readonly descargar = output<Descarga>();
  readonly fijarSemilla = output<number>();

  protected readonly pestanas: Pestana[] = [
    { id: 'tabla', texto: 'Tabla' },
    { id: 'mapa', texto: 'Mapa RI–II' },
    { id: 'tiempo', texto: 'En el tiempo' },
    { id: 'comparacion', texto: 'Contextos' },
    { id: 'descargas', texto: 'Descargas' },
  ];
  protected readonly pestana = signal('tabla');

  protected readonly numero = numero;
  protected readonly porcentaje = porcentaje;
  protected readonly formato3 = (y: number) => numero(y, 3);

  /** Cuántos registros son anomalía CIF (RI e II por encima de los cortes). */
  protected readonly numAnomaliasCif = computed(
    () => this.resultado().filas.filter((f) => esAnomaliaCif(f, this.cortes())).length,
  );

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
  /** Los de por defecto para este resultado: RI 0,25 e II en su umbral. */
  protected readonly cortesDefecto = computed(() => cortesPorDefecto(this.resultado().umbral));
  protected readonly cortesCambiados = computed(
    () =>
      this.cortes().ri !== this.cortesDefecto().ri || this.cortes().ii !== this.cortesDefecto().ii,
  );
  protected restablecerCortes(): void {
    this.cortes.set(this.cortesDefecto());
  }

  /** true si algún registro es anomalía en alguna partición. */
  protected readonly hayEnParticiones = computed(() =>
    this.resultado().filas.some((f) => f.ri > 0),
  );

  // --- Línea temporal ---

  /**
   * El eje x es el número de registro (lo pidió el tutor: "el registro 960"). Si
   * la tabla tiene fecha, se añade detrás, para el recuadro y la tabla de datos.
   */
  protected readonly formatoMomento = (registro: number): string => {
    const filas = this.resultado().filas;
    const fila = filas[Math.round(registro) - (filas[0]?.registro ?? 1)];
    if (!fila) {
      return String(Math.round(registro));
    }
    if (this.resultado().sinFecha) {
      return String(fila.registro);
    }
    // "2026-10-04T00:15:00.000Z" => "04/10 00:15". Si no es una fecha así, se deja como viene.
    const partes = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(fila.timestamp);
    const momento = partes
      ? `${partes[3]}/${partes[2]} ${partes[4]}:${partes[5]}`
      : fila.timestamp.slice(0, 16);
    return `${fila.registro} · ${momento}`;
  };

  protected readonly serieTiempo = computed<SerieLineas[]>(() => [
    {
      nombre: 'Score del IF global',
      color: 'var(--serie-1)',
      puntos: this.resultado().filas.map((f) => ({ x: f.registro, y: f.score })),
    },
  ]);

  protected readonly lineaUmbral = computed<LineaReferencia[]>(() => [
    { valor: this.resultado().umbral, etiqueta: `Umbral ${this.resultado().umbral}` },
  ]);

  /** Se marcan las anomalías globales (las de más score si son muchas). */
  protected readonly marcasTiempo = computed<MarcaPunto[]>(() =>
    this.resultado()
      .filas.filter((f) => f.anomalia)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MARCAS)
      .map((f) => ({ x: f.registro, y: f.score, color: 'var(--anomalia)' })),
  );
}
