import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { fusionar, ModoRelleno, OPCIONES_RELLENO, TablaFusionada } from '../core/logica/fusionar';
import {
  ejecutarIsolationForest,
  filasConMasScore,
  PARAMETROS_IF_POR_DEFECTO,
  ParametrosIsolationForest,
  ResultadoIsolationForest,
  scoresACsv,
  validarParametrosIF,
} from '../core/logica/aplicar-isolation-forest';
import { leerVariosCsv } from '../core/logica/leer-csv';
import {
  PARAMETROS_POR_DEFECTO,
  ParametrosColumnas,
  pivotar,
  TablaPivotada,
  tablaACsv,
  validarParametros,
} from '../core/logica/pivotar';
import { VistaPrevia } from '../vista-previa/vista-previa';

/**
 * Página principal: elegir CSVs, indicar columnas, procesar y descargar.
 * Solo gestiona la vista; la lógica está en core/logica.
 */
@Component({
  selector: 'app-pagina-principal',
  // FormsModule hace falta para usar [(ngModel)] y (ngSubmit) en el HTML
  imports: [FormsModule, VistaPrevia],
  templateUrl: './pagina-principal.html',
})
export class PaginaPrincipal {
  // Estos tres no son signals porque van enlazados con ngModel, que trabaja
  // mejor con propiedades normales. Hacemos copia con {...} para no modificar
  // las constantes por defecto al escribir en el formulario.

  /** Nombres de las columnas (enlazados al formulario con ngModel). */
  protected parametros: ParametrosColumnas = { ...PARAMETROS_POR_DEFECTO };
  /** Cómo rellenar los huecos de la tabla fusionada. */
  protected relleno: ModoRelleno = 'cero';
  protected readonly opcionesRelleno = OPCIONES_RELLENO;
  /** Parámetros del Isolation Forest (paso 3). */
  protected parametrosIF: ParametrosIsolationForest = { ...PARAMETROS_IF_POR_DEFECTO };

  /** Estado de la página. */
  // Con signals, cuando hacemos .set() Angular sabe solo qué partes del HTML repintar.
  protected readonly ficheros = signal<File[]>([]);
  protected readonly procesando = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Paso 1: todas las lecturas pivotadas por id. */
  protected readonly tabla = signal<TablaPivotada | null>(null);
  /** Paso 2: tipos pivotados por separado, alineados y con huecos rellenados. */
  protected readonly fusion = signal<TablaFusionada | null>(null);
  /** Paso 3: scores del Isolation Forest sobre la tabla fusionada. */
  protected readonly resultadoIF = signal<ResultadoIsolationForest | null>(null);
  // El error del paso 3 va aparte para que salga debajo de su propio formulario.
  protected readonly errorIF = signal<string | null>(null);

  // Los computed se recalculan solos cuando cambia algún signal que usan dentro.

  /** Las 10 filas con score más alto. */
  protected readonly topScores = computed(() => filasConMasScore(this.resultadoIF()?.filas ?? [], 10));

  /** Tamaño total de los ficheros elegidos, en MB. */
  protected readonly megasTotales = computed(
    () => this.ficheros().reduce((total, f) => total + f.size, 0) / 1024 / 1024,
  );

  /** Se llama al elegir uno o varios ficheros en el input. */
  protected alElegirFicheros(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    // input.files es una FileList, no un array, por eso el Array.from.
    this.ficheros.set(Array.from(input.files ?? []));
    // Si cambian los ficheros, los resultados de antes ya no valen y los quitamos.
    this.tabla.set(null);
    this.fusion.set(null);
    this.resultadoIF.set(null);
    this.errorIF.set(null);
    this.error.set(null);
  }

  /** Lee los CSV, los pivota (paso 1) y los fusiona por tipo (paso 2). */
  protected async procesar(): Promise<void> {
    const ficheros = this.ficheros();
    // El botón ya está desactivado sin ficheros, pero por si acaso.
    if (ficheros.length === 0) {
      return;
    }

    const errorParametros = validarParametros(this.parametros);
    if (errorParametros) {
      this.error.set(errorParametros);
      return;
    }

    // Copia con los nombres sin espacios sobrantes.
    const p: ParametrosColumnas = {
      timestamp: this.parametros.timestamp.trim(),
      id: this.parametros.id.trim(),
      valor: this.parametros.valor.trim(),
      tipo: this.parametros.tipo.trim(),
    };

    // Limpiamos lo anterior y ponemos el botón en "Procesando…".
    this.procesando.set(true);
    this.error.set(null);
    this.tabla.set(null);
    this.fusion.set(null);
    this.resultadoIF.set(null);
    this.errorIF.set(null);

    try {
      // Los CSV se leen una sola vez y con esas lecturas se hacen los dos pasos.
      const lecturas = await leerVariosCsv(ficheros, p);
      if (lecturas.length === 0) {
        throw new Error('Los CSV no tienen filas con datos.');
      }
      this.tabla.set(pivotar(lecturas, p.timestamp));
      this.fusion.set(fusionar(lecturas, p.timestamp, this.relleno));
    } catch (e) {
      // Lo que se lance en la lectura (p. ej. una columna que no existe) acaba aquí
      // y se enseña en el recuadro rojo.
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      // Pase lo que pase, el botón tiene que volver a estar disponible.
      this.procesando.set(false);
    }
  }

  /** Aplica el Isolation Forest a la tabla fusionada del paso 2. */
  protected ejecutarIF(): void {
    const tabla = this.fusion();
    if (!tabla) {
      return;
    }

    // Quitamos el resultado anterior para que no se quede uno viejo si los parámetros fallan.
    this.resultadoIF.set(null);
    const errorParametros = validarParametrosIF(this.parametrosIF);
    if (errorParametros) {
      this.errorIF.set(errorParametros);
      return;
    }

    // Aquí no hay async porque la librería calcula todo de forma síncrona.
    try {
      this.resultadoIF.set(ejecutarIsolationForest(tabla, this.parametrosIF));
      this.errorIF.set(null);
    } catch (e) {
      this.errorIF.set(e instanceof Error ? e.message : String(e));
    }
  }

  /** Descarga una tabla como fichero CSV con el nombre indicado. */
  // Se usa para 1_pivotado.csv y 2_fusionado.csv, que tienen el mismo formato.
  protected descargar(tabla: TablaPivotada, nombreFichero: string): void {
    this.guardarFichero(tablaACsv(tabla), nombreFichero);
  }

  /** Descarga los scores del Isolation Forest como 3_scores.csv. */
  protected descargarScores(resultado: ResultadoIsolationForest): void {
    this.guardarFichero(scoresACsv(resultado.filas), '3_scores.csv');
  }

  /** Hace que el navegador descargue un texto como fichero CSV. */
  // Como no hay servidor, el fichero se genera en el propio navegador:
  // metemos el texto en un Blob, le sacamos una URL temporal y simulamos
  // el clic en un enlace <a download> que ni siquiera llega a añadirse a la página.
  private guardarFichero(texto: string, nombreFichero: string): void {
    const blob = new Blob([texto], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreFichero;
    enlace.click();
    // Liberamos la URL, si no el Blob se queda ocupando memoria hasta cerrar la pestaña.
    URL.revokeObjectURL(url);
  }
}
