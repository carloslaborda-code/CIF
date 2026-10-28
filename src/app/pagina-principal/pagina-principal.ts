import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  fusionar,
  ModoRelleno,
  OPCIONES_RELLENO,
  prepararTablaPivotada,
  TablaFusionada,
  VALOR_RELLENO_POR_DEFECTO,
  validarRelleno,
} from '../core/logica/fusionar';
import {
  PARAMETROS_IF_POR_DEFECTO,
  ParametrosIsolationForest,
  validarParametrosIF,
} from '../core/logica/aplicar-isolation-forest';
import { cifACsv, ejecutarCif, ResultadoCif, resumenParticionesACsv } from '../core/logica/cif';
import {
  ConfiguracionCif,
  configuracionAJson,
  leerConfiguracion,
  VERSION_CONFIGURACION,
} from '../core/logica/configuracion';
import { Contexto, validarContextos } from '../core/logica/contextos';
import {
  aplicarFiltro,
  columnasACsv,
  esSinFiltro,
  etiquetasDeColumnas,
  FiltroLecturas,
  SIN_FILTRO,
} from '../core/logica/filtrar';
import { leerCsvPivotado, leerVariosCsv } from '../core/logica/leer-csv';
import {
  Lectura,
  PARAMETROS_POR_DEFECTO,
  ParametrosColumnas,
  pivotar,
  TablaPivotada,
  tablaACsv,
  validarParametros,
} from '../core/logica/pivotar';
import { EditorContextos } from '../editor-contextos/editor-contextos';
import { PanelFiltros } from '../panel-filtros/panel-filtros';
import { TablaCif } from '../tabla-cif/tabla-cif';
import { VistaPrevia } from '../vista-previa/vista-previa';

/**
 * De dónde salen los datos:
 * - 'largo':    CSV en formato largo, se pivotan y se fusionan (pasos 1 y 2).
 * - 'pivotado': un CSV ya pivotado, solo se rellenan sus huecos (paso 2).
 */
type OrigenDatos = 'largo' | 'pivotado';

/**
 * Página principal: elegir CSVs, indicar columnas, procesar y descargar.
 * Solo gestiona la vista; la lógica está en core/logica.
 */
@Component({
  selector: 'app-pagina-principal',
  // FormsModule hace falta para usar [(ngModel)] y (ngSubmit) en el HTML
  imports: [FormsModule, VistaPrevia, EditorContextos, TablaCif, PanelFiltros],
  templateUrl: './pagina-principal.html',
})
export class PaginaPrincipal {
  // Estos tres no son signals porque van enlazados con ngModel, que trabaja
  // mejor con propiedades normales. Hacemos copia con {...} para no modificar
  // las constantes por defecto al escribir en el formulario.

  /** Tipo de CSV que se va a cargar. */
  protected origen: OrigenDatos = 'largo';
  /** Nombres de las columnas (enlazados al formulario con ngModel). */
  protected parametros: ParametrosColumnas = { ...PARAMETROS_POR_DEFECTO };
  /** Cómo rellenar los huecos de la tabla fusionada. */
  protected relleno: ModoRelleno = 'fijo';
  /** Valor con el que se rellenan los huecos en el modo 'fijo' (entre 0 y 1). */
  protected valorRelleno: number = VALOR_RELLENO_POR_DEFECTO;
  protected readonly opcionesRelleno = OPCIONES_RELLENO;
  protected readonly esSinFiltro = esSinFiltro;
  /** Parámetros del Isolation Forest (paso 4), los mismos para el IF global y el de cada partición. */
  protected parametrosIF: ParametrosIsolationForest = { ...PARAMETROS_IF_POR_DEFECTO };
  /** Contextos y particiones (paso 3). Se mantienen aunque se vuelva a procesar el CSV. */
  protected contextos: Contexto[] = [];

  /** Estado de la página. */
  // Con signals, cuando hacemos .set() Angular sabe solo qué partes del HTML repintar.
  protected readonly ficheros = signal<File[]>([]);
  protected readonly procesando = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Todas las lecturas leídas del CSV largo, sin filtrar. Se guardan para
   *  poder cambiar el filtro sin volver a leer el fichero (puede ocupar decenas de MB). */
  protected readonly lecturas = signal<Lectura[] | null>(null);
  /** Columnas con las que se leyeron `lecturas` (van al JSON de configuración). */
  protected readonly parametrosLeidos = signal<ParametrosColumnas | null>(null);
  /** Filtro aplicado a las lecturas antes de pivotar. */
  protected readonly filtro = signal<FiltroLecturas>(SIN_FILTRO);
  /** Alias (aulario) de cada columna de la tabla fusionada, para el editor de contextos. */
  protected readonly etiquetas = signal<Record<string, string>>({});
  /** Paso 1: todas las lecturas pivotadas por id. */
  protected readonly tabla = signal<TablaPivotada | null>(null);
  /** Paso 2: tipos pivotados por separado, alineados y con huecos rellenados
   *  (o el CSV ya pivotado con sus huecos rellenados). */
  protected readonly fusion = signal<TablaFusionada | null>(null);
  /** Origen con el que se ha generado `fusion` (para el título del paso 2). */
  // Va aparte de `origen` porque el usuario puede cambiar el selector después de procesar.
  protected readonly origenProcesado = signal<OrigenDatos>('largo');
  /** Relleno con el que se ha generado `fusion` (va al JSON de configuración). */
  // Va aparte de `relleno` por lo mismo que origenProcesado.
  protected readonly rellenoProcesado = signal<ConfiguracionCif['relleno'] | null>(null);
  /** Paso 4: IF global + IF por partición con RI e II. */
  protected readonly resultadoCif = signal<ResultadoCif | null>(null);
  // El error del paso 4 va aparte para que salga debajo de su propio formulario.
  protected readonly errorCif = signal<string | null>(null);
  /** Aviso al cargar una configuración (bien o mal). */
  protected readonly mensajeConfiguracion = signal<{ texto: string; error: boolean } | null>(null);

  // Los computed se recalculan solos cuando cambia algún signal que usan dentro.

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
    this.limpiarResultados();
  }

  /** Quita los resultados y errores de un procesado anterior. */
  protected limpiarResultados(): void {
    this.lecturas.set(null);
    this.etiquetas.set({});
    this.tabla.set(null);
    this.fusion.set(null);
    this.resultadoCif.set(null);
    this.errorCif.set(null);
    this.error.set(null);
  }

  /**
   * Formato largo: lee los CSV, aplica el filtro, los pivota (paso 1) y los fusiona por tipo (paso 2).
   * Ya pivotado: lee el CSV y rellena sus huecos (paso 2), sin paso 1.
   */
  protected async procesar(): Promise<void> {
    const ficheros = this.ficheros();
    // El botón ya está desactivado sin ficheros, pero por si acaso.
    if (ficheros.length === 0) {
      return;
    }

    const errorRelleno = validarRelleno(this.relleno, this.valorRelleno);
    if (errorRelleno) {
      this.error.set(errorRelleno);
      return;
    }

    if (this.origen === 'pivotado') {
      await this.procesarPivotado(ficheros);
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
      alias: this.parametros.alias.trim(),
    };

    // Limpiamos lo anterior y ponemos el botón en "Procesando…".
    this.procesando.set(true);
    this.limpiarResultados();

    try {
      // Los CSV se leen una sola vez y con esas lecturas se hacen los dos pasos.
      const lecturas = await leerVariosCsv(ficheros, p);
      if (lecturas.length === 0) {
        throw new Error('Los CSV no tienen filas con datos.');
      }
      this.lecturas.set(lecturas);
      this.parametrosLeidos.set(p);
      this.origenProcesado.set('largo');
      this.procesarLecturas();
    } catch (e) {
      // Lo que se lance en la lectura (p. ej. una columna que no existe) acaba aquí
      // y se enseña en el recuadro rojo.
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      // Pase lo que pase, el botón tiene que volver a estar disponible.
      this.procesando.set(false);
    }
  }

  /**
   * Aplica el filtro a las lecturas ya leídas y hace los pasos 1 y 2 (pivotar y fusionar).
   * No vuelve a leer el CSV, por eso se puede llamar cada vez que cambia el filtro.
   */
  private procesarLecturas(): void {
    const lecturas = this.lecturas();
    const p = this.parametrosLeidos();
    if (!lecturas || !p) {
      return;
    }

    // Lo de antes ya no vale; las lecturas sí, para poder cambiar el filtro.
    this.tabla.set(null);
    this.fusion.set(null);
    this.resultadoCif.set(null);
    this.errorCif.set(null);
    this.error.set(null);

    const errorRelleno = validarRelleno(this.relleno, this.valorRelleno);
    if (errorRelleno) {
      this.error.set(errorRelleno);
      return;
    }
    const filtradas = aplicarFiltro(lecturas, this.filtro());
    if (filtradas.length === 0) {
      // Puede pasar con un filtro de otra configuración; el panel de filtros sigue visible para corregirlo.
      this.error.set('Ninguna lectura pasa el filtro. Cambia el filtro y pulsa "Aplicar filtros".');
      return;
    }

    this.tabla.set(pivotar(filtradas, p.timestamp));
    this.fusion.set(fusionar(filtradas, p.timestamp, this.relleno, this.valorRelleno));
    this.etiquetas.set(etiquetasDeColumnas(filtradas));
    this.rellenoProcesado.set({ modo: this.relleno, valor: this.valorRelleno });
  }

  /** Se llama desde el panel de filtros al pulsar "Aplicar filtros". */
  protected aplicarFiltros(filtro: FiltroLecturas): void {
    this.filtro.set(filtro);
    this.procesarLecturas();
  }

  /** Lee un CSV ya pivotado y rellena sus huecos; queda listo para los contextos y el CIF. */
  private async procesarPivotado(ficheros: File[]): Promise<void> {
    // Un CSV pivotado ya es la tabla entera, no tiene sentido juntar varios.
    if (ficheros.length !== 1) {
      this.error.set('Con un CSV ya pivotado elige un solo fichero.');
      return;
    }

    this.procesando.set(true);
    this.limpiarResultados();

    try {
      const tablaCargada = await leerCsvPivotado(ficheros[0]);
      this.fusion.set(prepararTablaPivotada(tablaCargada, this.relleno, this.valorRelleno));
      this.origenProcesado.set('pivotado');
      this.rellenoProcesado.set({ modo: this.relleno, valor: this.valorRelleno });
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.procesando.set(false);
    }
  }

  /** Descarga una tabla como fichero CSV con el nombre indicado. */
  // Se usa para 1_pivotado.csv y 2_fusionado.csv, que tienen el mismo formato.
  protected descargar(tabla: TablaPivotada, nombreFichero: string): void {
    this.guardarFichero(tablaACsv(tabla), nombreFichero);
  }

  /** Descarga columnas.csv: el tipo, uid y aulario de cada columna de la tabla fusionada. */
  protected descargarColumnas(tabla: TablaPivotada): void {
    const lecturas = aplicarFiltro(this.lecturas() ?? [], this.filtro());
    this.guardarFichero(columnasACsv(tabla.ids, lecturas), 'columnas.csv');
  }

  /** Deja fija una semilla en el formulario, para repetir una ejecución que ha salido al azar. */
  protected fijarSemilla(semilla: number): void {
    this.parametrosIF.semillaFija = true;
    this.parametrosIF.semilla = semilla;
  }

  /**
   * Paso 4: IF global y por partición sobre la tabla del paso 2, con RI e II.
   * Aquí no hay async porque la librería calcula todo de forma síncrona.
   */
  protected ejecutarCifPaso(): void {
    const tabla = this.fusion();
    if (!tabla) {
      return;
    }

    this.resultadoCif.set(null);
    const errorParametros =
      validarParametrosIF(this.parametrosIF) ?? validarContextos(this.contextos, tabla.ids);
    if (errorParametros) {
      this.errorCif.set(errorParametros);
      return;
    }

    try {
      this.resultadoCif.set(ejecutarCif(tabla, this.parametrosIF, this.contextos));
      this.errorCif.set(null);
    } catch (e) {
      this.errorCif.set(e instanceof Error ? e.message : String(e));
    }
  }

  /** Descarga la tabla CIF completa (todas las filas). */
  protected descargarCif(r: ResultadoCif): void {
    this.guardarFichero(cifACsv(r), `4_cif_semilla-${r.semilla}.csv`);
  }

  /** Descarga el resumen de cada partición. */
  protected descargarResumenParticiones(r: ResultadoCif): void {
    this.guardarFichero(resumenParticionesACsv(r), `4_cif_particiones_semilla-${r.semilla}.csv`);
  }

  /**
   * Descarga la configuración en JSON.
   * - Con un resultado del paso 4: la de esa ejecución, con la semilla que se usó.
   * - Sin resultado: la del formulario, con la semilla solo si está fija.
   */
  protected descargarConfiguracion(r: ResultadoCif | null): void {
    const configuracion: ConfiguracionCif = {
      version: VERSION_CONFIGURACION,
      fecha: new Date().toISOString(),
      ficheros: this.ficheros().map((f) => f.name),
      origen: this.origenProcesado(),
      columnas: this.parametrosLeidos() ?? { ...this.parametros },
      filtro: this.filtro(),
      relleno: this.rellenoProcesado() ?? { modo: this.relleno, valor: this.valorRelleno },
      // La muestra que se usó de verdad: con los mismos datos da el mismo resultado
      // que la pedida, porque ya es min(pedida, nº de filas).
      parametros: r
        ? {
            numArboles: r.numArboles,
            umbral: r.umbral,
            tamanoMuestra: r.tamanoMuestra,
            quitarConstantes: r.quitarConstantes,
          }
        : {
            numArboles: this.parametrosIF.numArboles,
            umbral: this.parametrosIF.umbral,
            tamanoMuestra: this.parametrosIF.tamanoMuestra,
            quitarConstantes: this.parametrosIF.quitarConstantes,
          },
      semilla: r ? r.semilla : this.parametrosIF.semillaFija ? this.parametrosIF.semilla : null,
      contextos: r ? r.contextos : this.contextos,
    };
    const nombre =
      configuracion.semilla === null
        ? 'configuracion.json'
        : `configuracion_semilla-${configuracion.semilla}.json`;
    this.guardarFichero(configuracionAJson(configuracion), nombre, 'application/json');
  }

  /**
   * Carga un JSON de configuración y rellena con él todo el formulario:
   * tipo de CSV, columnas, filtro, relleno, parámetros, semilla (fija) y contextos.
   */
  protected async cargarConfiguracion(evento: Event): Promise<void> {
    const input = evento.target as HTMLInputElement;
    const fichero = input.files?.[0];
    // Vaciamos el input para que se pueda volver a elegir el mismo fichero.
    input.value = '';
    if (!fichero) {
      return;
    }

    try {
      const c = leerConfiguracion(await fichero.text());
      // Con un CSV largo ya leído con las mismas columnas no hace falta volver a leerlo:
      // basta con aplicar el filtro y el relleno nuevos a las lecturas guardadas.
      const puedeReaplicar =
        this.lecturas() !== null &&
        c.origen === 'largo' &&
        (c.columnas === null ||
          JSON.stringify(c.columnas) === JSON.stringify(this.parametrosLeidos()));
      // Con un CSV pivotado, la tabla vale si no cambia el relleno.
      const procesado = this.rellenoProcesado();
      const pivotadoIgual =
        this.fusion() !== null &&
        this.origenProcesado() === 'pivotado' &&
        c.origen === 'pivotado' &&
        procesado !== null &&
        c.relleno.modo === procesado.modo &&
        c.relleno.valor === procesado.valor;

      this.origen = c.origen;
      if (c.columnas) {
        this.parametros = { ...c.columnas };
      }
      this.filtro.set(c.filtro);
      this.relleno = c.relleno.modo;
      this.valorRelleno = c.relleno.valor;
      this.parametrosIF = {
        ...c.parametros,
        semillaFija: c.semilla !== null,
        semilla: c.semilla ?? this.parametrosIF.semilla,
      };
      this.contextos = c.contextos;

      if (puedeReaplicar) {
        this.procesarLecturas();
      } else if (!pivotadoIgual) {
        this.limpiarResultados();
      }
      const ficheros = c.ficheros.length > 0 ? ` Se hizo con: ${c.ficheros.join(', ')}.` : '';
      const siguiente = this.fusion()
        ? 'Ya puedes ejecutar el CIF (paso 4).'
        : 'Elige el CSV y pulsa Procesar.';
      this.mensajeConfiguracion.set({
        texto: `Configuración cargada (semilla ${c.semilla ?? 'al azar'}, ${c.contextos.length} contexto(s)).${ficheros} ${siguiente}`,
        error: false,
      });
    } catch (e) {
      this.mensajeConfiguracion.set({
        texto: e instanceof Error ? e.message : String(e),
        error: true,
      });
    }
  }

  /** Hace que el navegador descargue un texto como fichero (CSV por defecto). */
  // Como no hay servidor, el fichero se genera en el propio navegador:
  // metemos el texto en un Blob, le sacamos una URL temporal y simulamos
  // el clic en un enlace <a download> que ni siquiera llega a añadirse a la página.
  private guardarFichero(texto: string, nombreFichero: string, tipo = 'text/csv'): void {
    const blob = new Blob([texto], { type: `${tipo};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = nombreFichero;
    enlace.click();
    // Liberamos la URL, si no el Blob se queda ocupando memoria hasta cerrar la pestaña.
    URL.revokeObjectURL(url);
  }
}
