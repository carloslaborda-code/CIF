/**
 * Configuración de una ejecución en JSON, para que otra persona pueda repetir
 * exactamente el mismo caso: con el mismo CSV, el mismo relleno, los mismos
 * parámetros, la misma semilla y los mismos contextos sale el mismo resultado.
 *
 * Se descarga desde la página y se puede volver a cargar en ella.
 */
import type { Contexto } from './contextos';
import { CampoFiltro, FiltroLecturas, SIN_FILTRO } from './filtrar';
import { ModoRelleno, OPCIONES_RELLENO } from './fusionar';
import type { ParametrosColumnas } from './pivotar';
import { validarSemilla } from './semilla';

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
  /** Nombres de las columnas del CSV largo. null en ficheros antiguos (se deja el formulario como está). */
  columnas: ParametrosColumnas | null;
  /** Filtro de lecturas por tipo, sensor y aulario (solo formato largo). */
  filtro: FiltroLecturas;
  relleno: { modo: ModoRelleno; valor: number };
  parametros: {
    numArboles: number;
    umbral: number;
    tamanoMuestra: number;
    quitarConstantes: boolean;
  };
  /** Semilla usada. null si se guardó antes de ejecutar y sin semilla fija. */
  semilla: number | null;
  contextos: Contexto[];
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

  const modos = OPCIONES_RELLENO.map((o) => o.valor);
  if (typeof d.relleno !== 'object' || d.relleno === null || !modos.includes(d.relleno.modo)) {
    throw new Error(`El relleno debe ser uno de: ${modos.join(', ')}.`);
  }

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

  return {
    version: d.version,
    fecha: String(d.fecha ?? ''),
    ficheros: Array.isArray(d.ficheros) ? d.ficheros.map(String) : [],
    origen: d.origen === 'pivotado' ? 'pivotado' : 'largo',
    columnas,
    filtro,
    relleno: { modo: d.relleno.modo, valor: Number(d.relleno.valor ?? 0) },
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
  };
}
