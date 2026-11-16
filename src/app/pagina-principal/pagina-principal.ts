import { Component, computed, ElementRef, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  columnasFusionadas,
  datasetEnColumnas,
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
import { CORTES_POR_DEFECTO, CortesClasificacion } from '../core/logica/clasificar';
import {
  ConfiguracionCif,
  configuracionAJson,
  leerConfiguracion,
  VERSION_CONFIGURACION,
} from '../core/logica/configuracion';
import { Contexto, validarContextos } from '../core/logica/contextos';
import {
  Diccionario,
  diccionarioACsv,
  Operacion,
  Preparacion,
  procesadoDelArticulo,
} from '../core/logica/preparar';
import {
  ESTIMACION_POR_DEFECTO,
  ParametrosEstimacion,
  ResultadoEstimacion,
} from '../core/logica/estimar';
import {
  aplicarFiltro,
  columnasACsv,
  esSinFiltro,
  etiquetasDeColumnas,
  FiltroLecturas,
  SIN_FILTRO,
} from '../core/logica/filtrar';
import {
  avisoDeHuecos,
  leerCsvPivotado,
  leerVariosCsv,
  registrosIncompletos,
} from '../core/logica/leer-csv';
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
import { numero } from '../graficos/escala';
import { PanelEstimacion, ValoresPropuestos } from '../panel-estimacion/panel-estimacion';
import { PanelPreparacion } from '../panel-preparacion/panel-preparacion';
import { PanelFiltros } from '../panel-filtros/panel-filtros';
import { Descarga, Resultados } from '../resultados/resultados';
import { BarraPasos, Paso } from '../ui/barra-pasos';
import { VistaPrevia } from '../vista-previa/vista-previa';

/**
 * De dónde salen los datos:
 * - 'largo':    CSV en formato largo, se pivotan y se fusionan.
 * - 'pivotado': un CSV ya pivotado, solo se rellenan sus huecos.
 */
type OrigenDatos = 'largo' | 'pivotado';

/** Título de cada paso del asistente. */
const TITULOS = ['Datos', 'Preparar', 'Contextos', 'Ajustes', 'Resultados'];

/**
 * Página principal: un asistente de cinco pasos.
 *
 *   1. Datos       elegir los CSV (o una configuración guardada) y leerlos
 *   2. Preparar    filtrar lecturas, rellenar huecos y revisar la tabla
 *   3. Contextos   definir contextos y particiones
 *   4. Ajustes     parámetros del Isolation Forest y estimación de árboles y umbral
 *   5. Resultados  tabla, gráficos y descargas
 *
 * Solo gestiona la vista y el estado; la lógica está en core/logica.
 */
@Component({
  selector: 'app-pagina-principal',
  // FormsModule hace falta para usar [(ngModel)] y (ngSubmit) en el HTML
  imports: [
    FormsModule,
    BarraPasos,
    VistaPrevia,
    PanelFiltros,
    PanelPreparacion,
    EditorContextos,
    PanelEstimacion,
    Resultados,
  ],
  templateUrl: './pagina-principal.html',
})
export class PaginaPrincipal {
  // Estos no son signals porque van enlazados con ngModel, que trabaja
  // mejor con propiedades normales. Hacemos copia con {...} para no modificar
  // las constantes por defecto al escribir en el formulario.

  /** Tipo de CSV que se va a cargar. */
  protected origen: OrigenDatos = 'largo';
  /** Solo con 'pivotado': el CSV no tiene columna de fecha; cada fila es un número de registro. */
  protected sinFecha = false;
  /** Nombres de las columnas (enlazados al formulario con ngModel). */
  protected parametros: ParametrosColumnas = { ...PARAMETROS_POR_DEFECTO };
  /** Cómo rellenar los huecos de la tabla fusionada. */
  protected relleno: ModoRelleno = 'fijo';
  /** Valor con el que se rellenan los huecos en el modo 'fijo' (entre 0 y 1). */
  protected valorRelleno: number = VALOR_RELLENO_POR_DEFECTO;
  protected readonly opcionesRelleno = OPCIONES_RELLENO;
  protected readonly esSinFiltro = esSinFiltro;
  protected readonly numero = numero;
  /** Parámetros del Isolation Forest, los mismos para el IF global y el de cada partición. */
  protected parametrosIF: ParametrosIsolationForest = { ...PARAMETROS_IF_POR_DEFECTO };
  /** Contextos y particiones. Se mantienen aunque se vuelva a procesar el CSV. */
  protected contextos: Contexto[] = [];

  /** Estado de la página. */
  // Con signals, cuando hacemos .set() Angular sabe solo qué partes del HTML repintar.

  /** Paso del asistente que se está viendo (1 a 5). */
  protected readonly paso = signal(1);
  protected readonly ficheros = signal<File[]>([]);
  /** true mientras se arrastra un fichero por encima de la zona de carga. */
  protected readonly arrastrando = signal(false);
  protected readonly procesando = signal(false);
  protected readonly error = signal<string | null>(null);
  /** Todas las lecturas leídas del CSV largo, sin filtrar. Se guardan para
   *  poder cambiar el filtro sin volver a leer el fichero (puede ocupar decenas de MB). */
  protected readonly lecturas = signal<Lectura[] | null>(null);
  /** El CSV ya pivotado tal como se leyó, para poder cambiar el relleno sin volver a leerlo. */
  private readonly tablaCargada = signal<TablaPivotada | null>(null);
  /** Columnas con las que se leyeron `lecturas` (van al JSON de configuración). */
  protected readonly parametrosLeidos = signal<ParametrosColumnas | null>(null);
  /** Filtro aplicado a las lecturas antes de pivotar. */
  protected readonly filtro = signal<FiltroLecturas>(SIN_FILTRO);
  /** Alias (aulario) de cada columna de la tabla fusionada, para el editor de contextos. */
  protected readonly etiquetas = signal<Record<string, string>>({});
  /** Todas las lecturas pivotadas por id (paso intermedio, solo con CSV largo). */
  protected readonly tabla = signal<TablaPivotada | null>(null);
  /** La tabla que se analiza: tipos pivotados por separado, alineados y con huecos
   *  rellenados (o el CSV ya pivotado con sus huecos rellenados). */
  protected readonly fusion = signal<TablaFusionada | null>(null);
  /** Origen con el que se ha generado `fusion`. */
  // Va aparte de `origen` porque el usuario puede cambiar el selector después de procesar.
  protected readonly origenProcesado = signal<OrigenDatos>('largo');
  /** Relleno con el que se ha generado `fusion` (va al JSON de configuración). */
  // Va aparte de `relleno` por lo mismo que origenProcesado.
  protected readonly rellenoProcesado = signal<ConfiguracionCif['relleno'] | null>(null);
  /**
   * Operaciones del procesado de características (3.1.1). null = las del
   * experimento del artículo (DD, MM, HH y MIN del timestamp), que se montan con
   * el nombre de la columna del timestamp al hacer la tabla.
   */
  protected readonly operaciones = signal<Operacion[] | null>(null);
  /** Diccionario de entrada de la codificación (3.1.2). Empieza vacío. */
  protected readonly diccionarioEntrada = signal<Diccionario>({});
  /** Preparación con la que se ha generado `fusion` (va al JSON de configuración). */
  protected readonly preparacionProcesada = signal<Preparacion | null>(null);
  /** Columnas de la tabla antes del procesado (para elegirlas en las operaciones). */
  protected readonly columnasBase = signal<string[]>([]);
  /** Nombre de la columna del timestamp de los datos leídos. */
  protected readonly columnaTimestamp = computed(() =>
    this.origenProcesado() === 'pivotado'
      ? (this.tablaCargada()?.columnaTimestamp ?? '')
      : (this.parametrosLeidos()?.timestamp ?? ''),
  );
  /** false si los datos leídos son una tabla sin columna de fecha (filas por número de registro). */
  protected readonly tieneFecha = computed(
    () => !(this.origenProcesado() === 'pivotado' && this.tablaCargada()?.sinFecha),
  );
  /**
   * Las operaciones pedidas. Por defecto, las del artículo montadas sobre el
   * timestamp; sin fecha no hay de dónde sacar DD, MM, HH y MIN, y no hay ninguna.
   */
  protected readonly operacionesPedidas = computed(
    () =>
      this.operaciones() ??
      (this.tieneFecha() ? procesadoDelArticulo(this.columnaTimestamp()) : []),
  );
  /** Ajustes de la estimación de hiperparámetros y su último resultado. */
  protected readonly ajustesEstimacion = signal<ParametrosEstimacion>({
    ...ESTIMACION_POR_DEFECTO,
  });
  protected readonly estimacion = signal<ResultadoEstimacion | null>(null);
  /** Por qué no se ha guardado el dataset en columnas (le faltan datos), o null. */
  protected readonly avisoDataset = signal<string | null>(null);
  /** Aviso que sale al aplicar los valores estimados. */
  protected readonly avisoAplicado = signal<string | null>(null);
  /** true mientras se calcula el CIF. */
  protected readonly ejecutando = signal(false);
  /** IF global + IF por partición con RI e II. */
  protected readonly resultadoCif = signal<ResultadoCif | null>(null);
  // El error del CIF va aparte para que salga debajo de su propio formulario.
  protected readonly errorCif = signal<string | null>(null);
  /** Cortes de RI e II para clasificar en grave, límite o normal. */
  protected readonly cortes = signal<CortesClasificacion>({ ...CORTES_POR_DEFECTO });
  /** Aviso al cargar una configuración (bien o mal). */
  protected readonly mensajeConfiguracion = signal<{ texto: string; error: boolean } | null>(null);
  /** Frase que se le dice al lector de pantalla cuando pasa algo (no se ve). */
  protected readonly anuncio = signal('');

  /** Título del paso actual: se le da el foco al cambiar de paso. */
  private readonly tituloPaso = viewChild<ElementRef<HTMLElement>>('tituloPaso');

  // Los computed se recalculan solos cuando cambia algún signal que usan dentro.

  /** Tamaño total de los ficheros elegidos, en MB. */
  protected readonly megasTotales = computed(
    () => this.ficheros().reduce((total, f) => total + f.size, 0) / 1024 / 1024,
  );

  protected readonly tituloActual = computed(() => TITULOS[this.paso() - 1]);

  // -------------------------------------------------------------------------
  // Asistente
  // -------------------------------------------------------------------------

  /**
   * Los cinco pasos con su estado, para la barra de arriba. Es un método y no un
   * computed porque mira propiedades normales (contextos, parametrosIF) además de signals.
   */
  protected listaPasos(): Paso[] {
    const tabla = this.fusion();
    const resultado = this.resultadoCif();
    const numParticiones = this.contextos.reduce((n, c) => n + c.particiones.length, 0);
    const resumenes = [
      this.ficheros().length > 0
        ? `${this.ficheros().length} ${this.ficheros().length === 1 ? 'fichero' : 'ficheros'}`
        : 'Elige los CSV',
      tabla
        ? `${numero(tabla.filas.length)} filas × ${tabla.ids.length} columnas`
        : 'Filtro y huecos',
      this.contextos.length > 0
        ? `${this.contextos.length} ${this.contextos.length === 1 ? 'contexto' : 'contextos'}, ${numParticiones} particiones`
        : 'Grupos de sensores',
      `${this.parametrosIF.numArboles ?? '?'} árboles · umbral ${this.parametrosIF.umbral ?? '?'}`,
      resultado ? `${numero(resultado.numAnomalias)} anomalías globales` : 'Sin ejecutar',
    ];
    const hechos = [
      tabla !== null,
      tabla !== null,
      this.contextos.length > 0,
      resultado !== null,
      resultado !== null,
    ];
    return TITULOS.map((titulo, i) => ({
      numero: i + 1,
      titulo,
      resumen: resumenes[i],
      hecho: hechos[i],
      // Sin tabla no se puede pasar del paso 1; sin resultado no hay paso 5.
      bloqueado: i === 0 ? false : i === 4 ? resultado === null : tabla === null,
    }));
  }

  /** Cambia de paso, sube arriba y le da el foco al título (para teclado y lector de pantalla). */
  protected irA(paso: number): void {
    if (this.listaPasos()[paso - 1].bloqueado) {
      return;
    }
    this.paso.set(paso);
    // Hay que esperar a que Angular pinte el paso nuevo.
    setTimeout(() => {
      window.scrollTo({ top: 0 });
      this.tituloPaso()?.nativeElement.focus();
    });
  }

  // -------------------------------------------------------------------------
  // Paso 1: datos
  // -------------------------------------------------------------------------

  /** Se llama al elegir uno o varios ficheros en el input. */
  protected alElegirFicheros(evento: Event): void {
    const input = evento.target as HTMLInputElement;
    // input.files es una FileList, no un array, por eso el Array.from.
    this.ponerFicheros(Array.from(input.files ?? []));
  }

  /** Se llama al soltar ficheros arrastrados encima de la zona de carga. */
  protected alSoltar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(false);
    const soltados = Array.from(evento.dataTransfer?.files ?? []).filter((f) =>
      f.name.toLowerCase().endsWith('.csv'),
    );
    if (soltados.length === 0) {
      this.error.set('Suelta ficheros .csv.');
      return;
    }
    this.ponerFicheros(soltados);
  }

  /** Mientras se arrastra por encima: hay que cancelar el evento para que deje soltar. */
  protected alArrastrar(evento: DragEvent): void {
    evento.preventDefault();
    this.arrastrando.set(true);
  }

  private ponerFicheros(ficheros: File[]): void {
    this.ficheros.set(ficheros);
    // Si cambian los ficheros, los resultados de antes ya no valen y los quitamos.
    this.limpiarResultados();
  }

  /** Quita los resultados y errores de un procesado anterior. */
  protected limpiarResultados(): void {
    this.lecturas.set(null);
    this.tablaCargada.set(null);
    this.columnasBase.set([]);
    this.etiquetas.set({});
    this.tabla.set(null);
    this.fusion.set(null);
    this.avisoDataset.set(null);
    this.quitarCalculos();
    this.error.set(null);
  }

  /** Quita lo que se ha calculado sobre la tabla (estimación y CIF): ya no corresponde. */
  private quitarCalculos(): void {
    this.estimacion.set(null);
    this.avisoAplicado.set(null);
    this.resultadoCif.set(null);
    this.errorCif.set(null);
    // Si se estaba en los resultados, ya no hay nada que ver ahí.
    if (this.paso() === 5) {
      this.paso.set(4);
    }
  }

  /**
   * Formato largo: lee los CSV, aplica el filtro, los pivota y los fusiona por tipo.
   * Ya pivotado: lee el CSV y rellena sus huecos.
   * Si todo va bien, pasa al paso 2.
   */
  protected async procesar(): Promise<void> {
    const ficheros = this.ficheros();
    if (ficheros.length === 0) {
      this.error.set('Elige primero al menos un fichero CSV.');
      return;
    }

    const errorRelleno = validarRelleno(this.relleno, this.valorRelleno);
    if (errorRelleno) {
      this.error.set(errorRelleno);
      return;
    }

    if (this.origen === 'pivotado') {
      await this.procesarPivotado(ficheros);
    } else {
      await this.procesarLargo(ficheros);
    }

    const tabla = this.fusion();
    if (tabla) {
      this.anuncio.set(
        `Datos leídos: ${tabla.filas.length} filas y ${tabla.ids.length} columnas. Paso 2, preparar.`,
      );
      this.irA(2);
    }
  }

  private async procesarLargo(ficheros: File[]): Promise<void> {
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

    // Limpiamos lo anterior y ponemos el botón en "Leyendo…".
    this.procesando.set(true);
    this.limpiarResultados();

    try {
      // Los CSV se leen una sola vez y con esas lecturas se hace todo lo demás.
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
      const tablaCargada = await leerCsvPivotado(ficheros[0], this.sinFecha);
      this.tablaCargada.set(tablaCargada);
      this.origenProcesado.set('pivotado');
      this.prepararPivotado(tablaCargada);
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.procesando.set(false);
    }
  }

  // -------------------------------------------------------------------------
  // Paso 2: preparar
  // -------------------------------------------------------------------------

  /**
   * Aplica el filtro y el relleno a las lecturas ya leídas, y pivota y fusiona.
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
    // Con otro filtro el dataset es otro: el aviso de antes ya no vale.
    this.avisoDataset.set(null);
    this.quitarCalculos();
    this.error.set(null);

    const errorRelleno = validarRelleno(this.relleno, this.valorRelleno);
    if (errorRelleno) {
      this.error.set(errorRelleno);
      return;
    }
    const filtradas = aplicarFiltro(lecturas, this.filtro());
    if (filtradas.length === 0) {
      // Puede pasar con un filtro de otra configuración; el panel de filtros sigue visible para corregirlo.
      this.error.set('Ninguna lectura pasa el filtro. Cambia el filtro y pulsa «Aplicar filtros».');
      return;
    }

    this.columnasBase.set(columnasFusionadas(filtradas));
    const preparacion = this.preparacionPara(p.timestamp);
    try {
      this.fusion.set(
        fusionar(filtradas, p.timestamp, this.relleno, this.valorRelleno, preparacion),
      );
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      return;
    }
    this.tabla.set(pivotar(filtradas, p.timestamp));
    this.etiquetas.set(etiquetasDeColumnas(filtradas));
    this.rellenoProcesado.set({ modo: this.relleno, valor: this.valorRelleno });
    this.preparacionProcesada.set(preparacion);
  }

  /** Procesa, codifica y rellena un CSV ya pivotado (sin volver a leerlo). */
  private prepararPivotado(cargada: TablaPivotada): void {
    this.quitarCalculos();
    this.error.set(null);
    this.fusion.set(null);
    this.columnasBase.set(cargada.ids);
    const preparacion = this.preparacionPara(cargada.columnaTimestamp, cargada.sinFecha);
    try {
      this.fusion.set(prepararTablaPivotada(cargada, this.relleno, this.valorRelleno, preparacion));
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : String(e));
      return;
    }
    this.rellenoProcesado.set({ modo: this.relleno, valor: this.valorRelleno });
    this.preparacionProcesada.set(preparacion);
  }

  /**
   * La preparación del formulario, con las operaciones del artículo si no se han
   * cambiado (ninguna si la tabla no tiene fecha).
   */
  private preparacionPara(columnaTimestamp: string, sinFecha = false): Preparacion {
    return {
      operaciones:
        this.operaciones() ?? (sinFecha ? [] : procesadoDelArticulo(columnaTimestamp)),
      diccionario: this.diccionarioEntrada(),
    };
  }

  /** Se llama desde el panel de filtros al pulsar "Aplicar filtros". */
  protected aplicarFiltros(filtro: FiltroLecturas): void {
    this.filtro.set(filtro);
    this.procesarLecturas();
    const tabla = this.fusion();
    if (tabla) {
      this.anuncio.set(
        `Filtro aplicado: quedan ${tabla.filas.length} filas y ${tabla.ids.length} columnas.`,
      );
    }
  }

  /** true si el relleno del formulario no es el que se usó para hacer la tabla. */
  protected rellenoPendiente(): boolean {
    const hecho = this.rellenoProcesado();
    return (
      hecho !== null &&
      (hecho.modo !== this.relleno ||
        (this.relleno === 'fijo' && hecho.valor !== this.valorRelleno))
    );
  }

  /** Vuelve a hacer la tabla con el relleno del formulario, sin leer otra vez el CSV. */
  protected aplicarRelleno(): void {
    const errorRelleno = validarRelleno(this.relleno, this.valorRelleno);
    if (errorRelleno) {
      this.error.set(errorRelleno);
      return;
    }
    this.rehacerTabla('Huecos rellenados de nuevo.');
  }

  /** Aplica las operaciones del procesado de características (3.1.1). */
  protected aplicarProcesado(operaciones: Operacion[]): void {
    this.operaciones.set(operaciones);
    this.rehacerTabla('Procesado aplicado.');
  }

  /** Vuelve a las operaciones por defecto (las del experimento del artículo). */
  protected restablecerProcesado(): void {
    this.operaciones.set(null);
    this.rehacerTabla('Procesado por defecto aplicado.');
  }

  /** Cambia el diccionario con el que empieza la codificación (3.1.2). */
  protected cambiarDiccionario(diccionario: Diccionario): void {
    this.diccionarioEntrada.set(diccionario);
    this.rehacerTabla(
      Object.keys(diccionario).length > 0 ? 'Diccionario cargado.' : 'Diccionario vaciado.',
    );
  }

  protected descargarDiccionario(f: TablaFusionada): void {
    this.guardarFichero(diccionarioACsv(f.diccionario), 'diccionario.csv');
  }

  /** Rehace la tabla con lo que hay en el formulario, sin leer otra vez el CSV. */
  private rehacerTabla(aviso: string): void {
    const cargada = this.tablaCargada();
    if (this.origenProcesado() === 'pivotado' && cargada) {
      this.prepararPivotado(cargada);
    } else {
      this.procesarLecturas();
    }
    this.anuncio.set(this.error() ?? aviso);
  }

  /** Descarga una tabla como fichero CSV con el nombre indicado. */
  // Se usa para 1_pivotado.csv y 2_fusionado.csv, que tienen el mismo formato.
  protected descargar(tabla: TablaPivotada, nombreFichero: string): void {
    this.guardarFichero(tablaACsv(tabla), nombreFichero);
  }

  /**
   * Descarga el dataset en columnas (con el filtro aplicado) para cargarlo la próxima
   * vez como "Una tabla ya hecha" sin tener que pivotar otra vez el CSV largo.
   * Si le faltan datos no se guarda, porque no se podría volver a cargar: se avisa
   * de en qué registros, con el mismo mensaje que al cargarlo.
   */
  protected descargarDataset(): void {
    const p = this.parametrosLeidos();
    if (!p) {
      return;
    }
    const lecturas = aplicarFiltro(this.lecturas() ?? [], this.filtro());
    const dataset = datasetEnColumnas(lecturas, p.timestamp);
    const incompletos = registrosIncompletos(
      dataset.filas.map((f) => f.valores),
      dataset.ids,
    );
    if (incompletos.length > 0) {
      const aviso = avisoDeHuecos('dataset.csv', incompletos);
      this.avisoDataset.set(aviso);
      this.anuncio.set(aviso);
      return;
    }
    this.avisoDataset.set(null);
    this.guardarFichero(tablaACsv(dataset), 'dataset.csv');
  }

  /** Descarga columnas.csv: el tipo, uid y aulario de cada columna de la tabla fusionada. */
  protected descargarColumnas(tabla: TablaPivotada): void {
    const lecturas = aplicarFiltro(this.lecturas() ?? [], this.filtro());
    this.guardarFichero(columnasACsv(tabla.ids, lecturas), 'columnas.csv');
  }

  // -------------------------------------------------------------------------
  // Paso 4: ajustes y ejecución
  // -------------------------------------------------------------------------

  /** Deja fija una semilla en el formulario, para repetir una ejecución que ha salido al azar. */
  protected fijarSemilla(semilla: number): void {
    this.parametrosIF.semillaFija = true;
    this.parametrosIF.semilla = semilla;
    this.anuncio.set(`Semilla ${semilla} fijada.`);
  }

  /** Copia al formulario los valores que propone la estimación. */
  protected aplicarEstimacion(v: ValoresPropuestos): void {
    this.parametrosIF.numArboles = v.numArboles;
    this.parametrosIF.umbral = v.umbral;
    this.parametrosIF.semillaFija = true;
    this.parametrosIF.semilla = v.semilla;
    const texto = `Valores aplicados: ${v.numArboles} árboles, umbral ${numero(v.umbral, 2)} y semilla ${v.semilla}.`;
    this.avisoAplicado.set(texto);
    this.anuncio.set(texto);
  }

  /**
   * IF global y por partición sobre la tabla, con RI e II. Si va bien, pasa al paso 5.
   * La librería calcula todo de forma síncrona; el pequeño respiro de antes es
   * para que al navegador le dé tiempo a pintar "Calculando…".
   */
  protected async ejecutarCifPaso(): Promise<void> {
    const tabla = this.fusion();
    if (!tabla || this.ejecutando()) {
      return;
    }

    const errorParametros =
      validarParametrosIF(this.parametrosIF) ?? validarContextos(this.contextos, tabla.ids);
    if (errorParametros) {
      this.errorCif.set(errorParametros);
      return;
    }

    this.ejecutando.set(true);
    this.errorCif.set(null);
    await new Promise((seguir) => setTimeout(seguir, 30));
    try {
      const resultado = ejecutarCif(tabla, this.parametrosIF, this.contextos);
      this.resultadoCif.set(resultado);
      this.anuncio.set(
        `CIF calculado: ${resultado.numAnomalias} anomalías globales de ${resultado.filas.length} registros. Paso 5, resultados.`,
      );
      this.irA(5);
    } catch (e) {
      this.errorCif.set(e instanceof Error ? e.message : String(e));
    } finally {
      this.ejecutando.set(false);
    }
  }

  // -------------------------------------------------------------------------
  // Paso 5: descargas
  // -------------------------------------------------------------------------

  /** Se llama desde los resultados al pulsar un botón de descarga. */
  protected descargarResultado(que: Descarga, r: ResultadoCif): void {
    if (que === 'tabla') {
      this.guardarFichero(cifACsv(r, this.cortes()), `4_cif_semilla-${r.semilla}.csv`);
    } else if (que === 'particiones') {
      this.guardarFichero(resumenParticionesACsv(r), `4_cif_particiones_semilla-${r.semilla}.csv`);
    } else {
      this.descargarConfiguracion(r);
    }
  }

  // -------------------------------------------------------------------------
  // Configuración (JSON)
  // -------------------------------------------------------------------------

  /**
   * Descarga la configuración en JSON.
   * - Con un resultado del CIF: la de esa ejecución, con la semilla que se usó.
   * - Sin resultado: la del formulario, con la semilla solo si está fija.
   */
  protected descargarConfiguracion(r: ResultadoCif | null): void {
    const configuracion: ConfiguracionCif = {
      version: VERSION_CONFIGURACION,
      fecha: new Date().toISOString(),
      ficheros: this.ficheros().map((f) => f.name),
      origen: this.origenProcesado(),
      sinFecha: !this.tieneFecha(),
      columnas: this.parametrosLeidos() ?? { ...this.parametros },
      filtro: this.filtro(),
      // Las operaciones que se usaron y el diccionario que salió de la tabla, para que
      // otros datos se codifiquen con los mismos números.
      preparacion: {
        operaciones:
          this.preparacionProcesada()?.operaciones ??
          this.preparacionPara(this.parametros.timestamp, !this.tieneFecha()).operaciones,
        diccionario: this.fusion()?.diccionario ?? this.diccionarioEntrada(),
      },
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
      estimacion: this.ajustesEstimacion(),
      cortes: this.cortes(),
    };
    const nombre =
      configuracion.semilla === null
        ? 'configuracion.json'
        : `configuracion_semilla-${configuracion.semilla}.json`;
    this.guardarFichero(configuracionAJson(configuracion), nombre, 'application/json');
  }

  /**
   * Carga un JSON de configuración y rellena con él todo el formulario:
   * tipo de CSV, columnas, filtro, relleno, parámetros, semilla (fija), contextos,
   * ajustes de la estimación y cortes de la clasificación.
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
      // Con un CSV pivotado ya leído, tampoco: se vuelve a preparar y rellenar.
      // Si cambia "sin columna de fecha", hay que volver a leerlo.
      const cargada = this.tablaCargada();
      const puedeRepreparar =
        cargada !== null &&
        this.origenProcesado() === 'pivotado' &&
        c.origen === 'pivotado' &&
        (cargada.sinFecha === true) === c.sinFecha;

      this.origen = c.origen;
      this.sinFecha = c.sinFecha;
      if (c.columnas) {
        this.parametros = { ...c.columnas };
      }
      this.filtro.set(c.filtro);
      this.operaciones.set(c.preparacion.operaciones);
      this.diccionarioEntrada.set(c.preparacion.diccionario);
      this.relleno = c.relleno.modo;
      this.valorRelleno = c.relleno.valor;
      this.parametrosIF = {
        ...c.parametros,
        semillaFija: c.semilla !== null,
        semilla: c.semilla ?? this.parametrosIF.semilla,
      };
      this.contextos = c.contextos;
      this.ajustesEstimacion.set(c.estimacion);
      this.cortes.set(c.cortes);

      if (puedeReaplicar) {
        this.procesarLecturas();
      } else if (puedeRepreparar) {
        this.prepararPivotado(cargada);
      } else {
        this.limpiarResultados();
        this.paso.set(1);
      }
      const ficheros = c.ficheros.length > 0 ? ` Se hizo con: ${c.ficheros.join(', ')}.` : '';
      const siguiente = this.fusion()
        ? 'Ya puedes ejecutar el CIF en el paso 4.'
        : 'Ahora elige el CSV y pulsa «Leer los datos».';
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
    this.anuncio.set(`Descargado ${nombreFichero}.`);
  }
}
