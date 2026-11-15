import {
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  ParametrosIsolationForest,
  validarParametrosIF,
} from '../core/logica/aplicar-isolation-forest';
import {
  ParametrosEstimacion,
  pasosEstimacion,
  ProgresoEstimacion,
  ResultadoEstimacion,
  validarEstimacion,
} from '../core/logica/estimar';
import type { TablaPivotada } from '../core/logica/pivotar';
import { numero, porcentaje } from '../graficos/escala';
import { GraficoHistograma } from '../graficos/grafico-histograma';
import { GraficoLineas, LineaReferencia, SerieLineas } from '../graficos/grafico-lineas';

/** Los tres paneles de la Fig. 6. */
type VistaArboles = 'valores' | 'diferencia' | 'acumulada';

/** Lo que se le pasa al padre al pulsar "Aplicar". */
export interface ValoresPropuestos {
  numArboles: number;
  umbral: number;
  semilla: number;
}

/**
 * Estimación de árboles y umbral (procedimiento 2 del artículo).
 *
 * Tiene el botón "Estimar", la barra de progreso y, cuando termina, los valores
 * propuestos con las tres gráficas del artículo (Fig. 5, 6 y 7). El cálculo está
 * en core/logica/estimar.ts; aquí solo se lanza por trozos para no congelar la
 * página y se pinta el resultado.
 *
 * Uso: <app-panel-estimacion [tabla]="..." [parametrosIF]="..." [(ajustes)]="..."
 *        [(resultado)]="..." (aplicar)="..." />
 */
@Component({
  selector: 'app-panel-estimacion',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  imports: [FormsModule, GraficoHistograma, GraficoLineas],
  templateUrl: './panel-estimacion.html',
})
export class PanelEstimacion {
  /** Tabla sobre la que se estima (la misma que usará el CIF). */
  readonly tabla = input.required<TablaPivotada>();
  /** Parámetros del IF del formulario: de aquí salen la muestra, la semilla y las constantes. */
  readonly parametrosIF = input.required<ParametrosIsolationForest>();
  /** Ajustes de la estimación; los guarda el padre para meterlos en el JSON. */
  readonly ajustes = model.required<ParametrosEstimacion>();
  /** Última estimación; la guarda el padre para que no se pierda al cambiar de paso. */
  readonly resultado = model.required<ResultadoEstimacion | null>();
  /** Se pulsa "Aplicar": el padre copia los valores al formulario. */
  readonly aplicar = output<ValoresPropuestos>();

  protected readonly progreso = signal<ProgresoEstimacion | null>(null);
  protected readonly error = signal<string | null>(null);
  /** Se pone a true al pulsar "Cancelar" o al salir del paso. */
  private cancelado = false;

  protected readonly numero = numero;
  protected readonly porcentaje = porcentaje;
  protected readonly formatoEntero = (x: number) => String(Math.round(x));
  protected readonly formatoPorcentaje = (x: number) => porcentaje(x);
  protected readonly formato2 = (y: number) => numero(y, 2);
  protected readonly formato3 = (y: number) => numero(y, 3);

  constructor() {
    // Si se sale del paso con el cálculo a medias, se para.
    inject(DestroyRef).onDestroy(() => (this.cancelado = true));
  }

  protected readonly textoFase: Record<ProgresoEstimacion['fase'], string> = {
    histograma: 'Calculando el histograma de scores…',
    arboles: 'Probando distintos números de árboles…',
    umbral: 'Probando distintos niveles de contaminación…',
    comprobacion: 'Comprobando el resultado sobre toda la tabla…',
  };

  /** Los porcentajes se escriben en la pantalla como 1 o 50, y se guardan como 0.01 o 0.5. */
  protected get porcentajeContaminados(): number {
    return Math.round(this.ajustes().fraccionContaminada * 1000) / 10;
  }
  protected set porcentajeContaminados(valor: number) {
    this.ajustes.set({ ...this.ajustes(), fraccionContaminada: valor / 100 });
  }
  protected get porcentajeSubida(): number {
    return Math.round(this.ajustes().contaminacionArboles * 100);
  }
  protected set porcentajeSubida(valor: number) {
    this.ajustes.set({ ...this.ajustes(), contaminacionArboles: valor / 100 });
  }
  protected get sensores(): number {
    return this.ajustes().sensoresPorRegistro;
  }
  protected set sensores(valor: number) {
    this.ajustes.set({ ...this.ajustes(), sensoresPorRegistro: valor });
  }

  /**
   * Lanza la estimación. El cálculo va por pasos (un Isolation Forest cada vez)
   * y cada 40 ms se le deja un respiro al navegador para que pinte el progreso
   * y atienda al botón de cancelar.
   */
  protected async estimar(): Promise<void> {
    // El número de árboles y el umbral del formulario no se usan (son lo que se
    // estima), pero la muestra y la semilla sí tienen que estar bien.
    const p = this.parametrosIF();
    const fallo =
      validarParametrosIF({ ...p, numArboles: 1, umbral: 0.5 }) ??
      validarEstimacion(this.ajustes());
    if (fallo) {
      this.error.set(fallo);
      return;
    }

    this.error.set(null);
    this.resultado.set(null);
    this.cancelado = false;
    this.progreso.set({ fase: 'histograma', hecho: 0, total: 1 });
    const respiro = () => new Promise((seguir) => setTimeout(seguir));

    try {
      await respiro();
      const pasos = pasosEstimacion(this.tabla(), { ...p }, { ...this.ajustes() });
      let ultimoRespiro = performance.now();
      let paso = pasos.next();
      while (!paso.done) {
        this.progreso.set(paso.value);
        if (performance.now() - ultimoRespiro > 40) {
          await respiro();
          ultimoRespiro = performance.now();
        }
        if (this.cancelado) {
          return;
        }
        paso = pasos.next();
      }
      this.resultado.set(paso.value);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.progreso.set(null);
    }
  }

  protected cancelar(): void {
    this.cancelado = true;
  }

  protected alAplicar(r: ResultadoEstimacion): void {
    this.aplicar.emit({
      numArboles: r.arbolesPropuestos,
      umbral: r.umbralPropuesto,
      semilla: r.semilla,
    });
  }

  // --- Datos de las gráficas ---

  /**
   * Fig. 6: Accuracy, Precision, Recall y F1 según el número de árboles, en los
   * tres paneles del artículo: a) valores, b) diferencia con la prueba anterior
   * y c) diferencia acumulada.
   * Precision, Recall y F1 coinciden siempre (se marcan tantos registros como
   * contaminados hay), así que sus tres líneas quedan una encima de otra.
   */
  private seriesArboles(vista: VistaArboles): SerieLineas[] {
    const r = this.resultado();
    if (!r) {
      return [];
    }
    /** Pasa los valores de una métrica a lo que pide el panel. */
    const transformar = (valores: number[]): number[] => {
      if (vista === 'valores') {
        return valores;
      }
      // Diferencia con la prueba anterior (la primera no tiene anterior: 0).
      const diferencias = valores.map((v, i) => (i === 0 ? 0 : v - valores[i - 1]));
      if (vista === 'diferencia') {
        return diferencias;
      }
      let suma = 0;
      return diferencias.map((d) => (suma += d));
    };
    const serie = (nombre: string, color: string, valores: number[]): SerieLineas => ({
      nombre,
      color,
      puntos: transformar(valores).map((y, i) => ({ x: r.arboles[i].numArboles, y })),
    });
    return [
      serie(
        'Accuracy',
        'var(--serie-2)',
        r.arboles.map((x) => x.accuracy),
      ),
      serie(
        'Precision',
        'var(--serie-3)',
        r.arboles.map((x) => x.precision),
      ),
      serie(
        'Recall',
        'var(--serie-4)',
        r.arboles.map((x) => x.recall),
      ),
      serie(
        'F1-Score',
        'var(--serie-1)',
        r.arboles.map((x) => x.f1),
      ),
    ];
  }
  protected readonly arbolesValores = computed(() => this.seriesArboles('valores'));
  protected readonly arbolesDiferencia = computed(() => this.seriesArboles('diferencia'));
  protected readonly arbolesAcumulada = computed(() => this.seriesArboles('acumulada'));

  protected readonly lineaArboles = computed<LineaReferencia[]>(() => {
    const r = this.resultado();
    return r ? [{ valor: r.arbolesPropuestos, etiqueta: `${r.arbolesPropuestos} árboles` }] : [];
  });

  /** Fig. 7: umbral mínimo según la contaminación. */
  protected readonly seriesUmbral = computed<SerieLineas[]>(() => {
    const r = this.resultado();
    return r
      ? [
          {
            nombre: 'Umbral mínimo',
            color: 'var(--serie-1)',
            puntos: r.umbrales.map((u) => ({ x: u.contaminacion, y: u.umbral })),
          },
        ]
      : [];
  });

  protected readonly lineaUmbral = computed<LineaReferencia[]>(() => {
    const r = this.resultado();
    return r
      ? [{ valor: r.umbralPropuesto, etiqueta: `Umbral ${numero(r.umbralPropuesto, 2)}` }]
      : [];
  });

  protected readonly lineaContaminacion = computed<LineaReferencia[]>(() => {
    const r = this.resultado();
    return r && r.contaminacionEstable !== null
      ? [
          {
            valor: r.contaminacionEstable,
            etiqueta: `Estable desde ${porcentaje(r.contaminacionEstable)}`,
          },
        ]
      : [];
  });
}
