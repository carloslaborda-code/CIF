/**
 * Configuración de una ejecución en JSON, para que otra persona pueda repetir
 * exactamente el mismo caso: con el mismo CSV, la misma preparación, los mismos
 * parámetros, la misma semilla y los mismos contextos sale el mismo resultado.
 *
 * Se descarga desde la página y se puede volver a cargar en ella.
 */
import { CORTES_POR_DEFECTO, CortesClasificacion, validarCortes } from './clasificar';
import type { Contexto } from './contextos';
import { CampoFiltro, FiltroLecturas, SIN_FILTRO } from './filtrar';
import type { ParametrosColumnas } from './pivotar';
import { OPCIONES_EXTRACCION, Operacion, Preparacion, SIN_PREPARACION } from './preparar';
import { ParametrosNormalizacion, validarParametros as validarParametrosZscore } from './normalizar';
import { RangoRegistros, SIN_RANGO, validarRango } from './rango';
import { validarSemilla } from './semilla';

/**
 * Normalización z-score (normalizar.ts). Con 'cargados', los parámetros se
 * vuelven a usar tal cual al cargar la configuración (como si se cargara el
 * fichero). Con 'propios', se calculan otra vez con los datos que haya: los
 * guardados son solo para saber qué salió.
 */
export interface ConfiguracionZscore {
  activo: boolean;
  modo: 'propios' | 'cargados';
  /** Nombre del fichero de parámetros, con 'cargados'. Solo informativo. */
  fichero: string | null;
  /** Media y desviación usadas. null si el z-score no estaba activado. */
  parametros: ParametrosNormalizacion | null;
}

export const SIN_ZSCORE: ConfiguracionZscore = {
  activo: false,
  modo: 'propios',
  fichero: null,
  parametros: null,
};

/** Sube este número si cambia el formato, para poder reconocer ficheros antiguos. */
export const VERSION_CONFIGURACION = 1;

export interface ConfiguracionCif {
  version: number;
  /** Fecha en que se generó (solo informativa). */
  fecha: string;
  /** Nombres de los CSV que se usaron (solo informativo, no se comprueba). */
  ficheros: string[];
  /** Tipo de CSV: formato largo o ya pivotado. */
  origen: 'largo' | 'pivotado';
  /**
   * Solo con 'pivotado': true si el CSV no tiene columna de fecha y las filas se
   * identifican por su número de registro. false en ficheros antiguos.
   */
  sinFecha: boolean;
  /** Nombres de las columnas del CSV largo. null en ficheros antiguos (se deja el formulario como está). */
  columnas: ParametrosColumnas | null;
  /** Filtro de lecturas por tipo, sensor y aulario (solo formato largo). */
  filtro: FiltroLecturas;
  /** Rango de registros (rango.ts). SIN_RANGO en ficheros antiguos. */
  rango: RangoRegistros;
  /** Procesado de características. */
  preparacion: Preparacion;
  /** Normalización z-score. SIN_ZSCORE en ficheros antiguos. */
  zscore: ConfiguracionZscore;
  parametros: {
    numArboles: number;
    umbral: number;
    tamanoMuestra: number;
    quitarConstantes: boolean;
  };
  /** Semilla usada. null si se guardó antes de ejecutar y sin semilla fija. */
  semilla: number | null;
  contextos: Contexto[];
  /** Cortes de RI e II para clasificar en grave, límite o normal. */
  cortes: CortesClasificacion;
}

/** Texto JSON (con sangría para que se pueda leer y editar a mano). */
export function configuracionAJson(c: ConfiguracionCif): string {
  return JSON.stringify(c, null, 2);
}

/**
 * Lee y comprueba un JSON de configuración. Lanza un Error con un mensaje
 * entendible si el fichero no tiene el formato esperado.
 * No comprueba que las columnas existan: eso depende del CSV cargado y lo
 * hace validarContextos al ejecutar.
 */
export function leerConfiguracion(texto: string): ConfiguracionCif {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch {
    throw new Error('El fichero no es un JSON válido.');
  }

  // A partir de aquí vamos mirando campo a campo; `any` porque viene de fuera.
  const d = datos as any;
  if (typeof d !== 'object' || d === null || d.version !== VERSION_CONFIGURACION) {
    throw new Error(`No es una configuración del CIF (versión ${VERSION_CONFIGURACION}).`);
  }

  const p = d.parametros;
  if (
    typeof p !== 'object' ||
    p === null ||
    typeof p.numArboles !== 'number' ||
    typeof p.umbral !== 'number' ||
    typeof p.tamanoMuestra !== 'number'
  ) {
    throw new Error('Faltan los parámetros (numArboles, umbral, tamanoMuestra).');
  }

  if (d.semilla !== null && validarSemilla(d.semilla) !== null) {
    throw new Error(validarSemilla(d.semilla)!);
  }

  // Los ficheros de antes traen "relleno" (cómo se rellenaban los huecos). Ya no
  // se usa: los nulos se tratan antes de cargar el CSV. Se ignora sin dar error.

  if (!Array.isArray(d.contextos)) {
    throw new Error('Falta la lista de contextos.');
  }
  const contextos: Contexto[] = d.contextos.map((c: any) => {
    if (typeof c?.nombre !== 'string' || !Array.isArray(c.particiones)) {
      throw new Error('Hay un contexto sin nombre o sin lista de particiones.');
    }
    return {
      nombre: c.nombre,
      particiones: c.particiones.map((pa: any) => {
        if (typeof pa?.nombre !== 'string' || !Array.isArray(pa.columnas)) {
          throw new Error(
            `En el contexto "${c.nombre}" hay una partición sin nombre o sin columnas.`,
          );
        }
        return {
          nombre: pa.nombre,
          columnas: pa.columnas.map(String),
          // Si no trae peso (por ejemplo, escrito a mano), vale 1.
          peso: typeof pa.peso === 'number' ? pa.peso : 1,
        };
      }),
    };
  });

  // Columnas y filtro pueden faltar en configuraciones guardadas antes de añadirlos.
  let columnas: ParametrosColumnas | null = null;
  if (typeof d.columnas === 'object' && d.columnas !== null) {
    const c = d.columnas;
    columnas = {
      timestamp: String(c.timestamp ?? ''),
      id: String(c.id ?? ''),
      valor: String(c.valor ?? ''),
      tipo: String(c.tipo ?? ''),
      alias: String(c.alias ?? ''),
    };
  }

  const filtro: FiltroLecturas = { ...SIN_FILTRO };
  if (typeof d.filtro === 'object' && d.filtro !== null) {
    for (const campo of Object.keys(SIN_FILTRO) as CampoFiltro[]) {
      const valores = d.filtro[campo];
      if (valores !== null && valores !== undefined && !Array.isArray(valores)) {
        throw new Error(`El filtro "${campo}" debe ser una lista de valores o null.`);
      }
      filtro[campo] = Array.isArray(valores) ? valores.map(String) : null;
    }
  }

  // El rango se añadió después: si falta, toda la tabla.
  const rango: RangoRegistros = { ...SIN_RANGO };
  if (typeof d.rango === 'object' && d.rango !== null) {
    rango.desde = d.rango.desde ?? null;
    rango.hasta = d.rango.hasta ?? null;
    const errorRango = validarRango(rango);
    if (errorRango) {
      throw new Error(errorRango);
    }
  }

  // La preparación se añadió después. Si falta, no se procesa nada (así se
  // repiten igual los resultados de antes).
  const preparacion: Preparacion = { operaciones: [...SIN_PREPARACION.operaciones] };
  if (typeof d.preparacion === 'object' && d.preparacion !== null) {
    const pr = d.preparacion;
    if (!Array.isArray(pr.operaciones)) {
      throw new Error('La preparación debe traer una lista de operaciones.');
    }
    preparacion.operaciones = pr.operaciones.map(leerOperacion);
  }

  // El z-score se añadió después: si falta, sin normalizar.
  const zscore: ConfiguracionZscore = { ...SIN_ZSCORE };
  if (typeof d.zscore === 'object' && d.zscore !== null) {
    const z = d.zscore;
    if (typeof z.activo !== 'boolean') {
      throw new Error('El z-score debe decir si está activado (activo: true o false).');
    }
    if (z.modo !== 'propios' && z.modo !== 'cargados') {
      throw new Error('El modo del z-score debe ser "propios" o "cargados".');
    }
    zscore.activo = z.activo;
    zscore.modo = z.modo;
    zscore.fichero = typeof z.fichero === 'string' ? z.fichero : null;
    if (z.parametros !== null && z.parametros !== undefined) {
      if (!Array.isArray(z.parametros)) {
        throw new Error('Los parámetros del z-score deben ser una lista.');
      }
      const parametros: ParametrosNormalizacion = z.parametros.map((p: any) => ({
        columna: String(p?.columna ?? ''),
        media: Number(p?.media),
        desviacion: Number(p?.desviacion),
      }));
      const errorParametros = validarParametrosZscore(parametros);
      if (errorParametros) {
        throw new Error(`Z-score: ${errorParametros}`);
      }
      zscore.parametros = parametros;
    }
    if (zscore.modo === 'cargados' && zscore.parametros === null) {
      throw new Error('El z-score usa parámetros cargados, pero la configuración no los trae.');
    }
  }

  // Los cortes se añadieron después: si faltan, los del artículo.
  const cortes: CortesClasificacion = { ...CORTES_POR_DEFECTO };
  if (typeof d.cortes === 'object' && d.cortes !== null) {
    if (typeof d.cortes.ri === 'number') cortes.ri = d.cortes.ri;
    if (typeof d.cortes.ii === 'number') cortes.ii = d.cortes.ii;
    const errorCortes = validarCortes(cortes);
    if (errorCortes) {
      throw new Error(errorCortes);
    }
  }

  return {
    version: d.version,
    fecha: String(d.fecha ?? ''),
    ficheros: Array.isArray(d.ficheros) ? d.ficheros.map(String) : [],
    origen: d.origen === 'pivotado' ? 'pivotado' : 'largo',
    sinFecha: d.origen === 'pivotado' && d.sinFecha === true,
    columnas,
    filtro,
    rango,
    preparacion,
    zscore,
    parametros: {
      numArboles: p.numArboles,
      umbral: p.umbral,
      tamanoMuestra: p.tamanoMuestra,
      // Las configuraciones de antes de existir la opción no quitaban nada:
      // si falta, false, para que se repitan exactamente igual.
      quitarConstantes: p.quitarConstantes === true,
    },
    semilla: d.semilla,
    contextos,
    cortes,
  };
}

/** Lee una operación del procesado. Lanza un Error si no es de un tipo conocido. */
function leerOperacion(o: any, i: number): Operacion {
  const texto = (x: unknown) => String(x ?? '');
  switch (o?.tipo) {
    case 'extraer': {
      const ops = OPCIONES_EXTRACCION.map((x) => x.valor);
      if (!ops.includes(o.op)) {
        throw new Error(`Operación ${i + 1}: la extracción debe ser una de: ${ops.join(', ')}.`);
      }
      const op: Operacion = {
        tipo: 'extraer',
        origen: texto(o.origen),
        destino: texto(o.destino),
        op: o.op,
      };
      if (o.op === 'subcadena') {
        op.inicio = Number(o.inicio);
        op.longitud = Number(o.longitud);
      }
      return op;
    }
    case 'combinar':
      return { tipo: 'combinar', a: texto(o.a), b: texto(o.b), destino: texto(o.destino) };
    case 'eliminar':
      return { tipo: 'eliminar', columna: texto(o.columna) };
    case 'anadir':
      return { tipo: 'anadir', destino: texto(o.destino), valor: texto(o.valor) };
    default:
      throw new Error(`Operación ${i + 1}: el tipo debe ser extraer, combinar, eliminar o anadir.`);
  }
}
