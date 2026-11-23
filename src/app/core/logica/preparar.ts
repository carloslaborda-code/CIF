/**
 * Procesado de características (preparación de datos del artículo).
 *
 * Los nulos no los trata la herramienta: se tratan antes de cargar el CSV, y si
 * falta algún dato fusionar.ts da un error. Los contextos están en contextos.ts.
 * El procesado se aplica a la tabla alineada (ya sin huecos).
 *
 * Una lista de operaciones (la "Config" del artículo) que se aplican una detrás
 * de otra:
 *   - Extracción (F, Fextrac, op): saca una característica nueva de F. Para fechas,
 *     día, mes, año, hora, minuto o día de la semana; para texto, un trozo.
 *   - Combinación (F1, F2, Fcomb): junta F1 y F2 en una característica nueva.
 *   - Eliminación (F): quita F.
 *   - Adición (Fnew, default): añade Fnew con el valor "default" en todas las filas.
 *   Por defecto se hace lo mismo que el artículo en su experimento (4.2.1): sacar
 *   DD, MM, HH y MIN de la fecha. La fecha original deja de ser característica,
 *   como en el artículo; aquí nunca lo fue, solo identifica la fila.
 *
 * Después del procesado, todas las columnas tienen que ser numéricas: el
 * Isolation Forest solo trabaja con números. Si alguna no lo es, es un error.
 *
 * Lo que el artículo no concreta y aquí se ha decidido:
 *   - La combinación concatena los dos valores como texto (F1_F2). Si falta uno
 *     de los dos valores, el resultado es un hueco y fusionar.ts da un error (la
 *     herramienta no trata los nulos).
 *   - La hora, el día... se leen tal cual están escritos en el CSV, sin cambiar
 *     de zona horaria, igual que se hace al exportar los CSV.
 */
import type { TablaPivotada } from './pivotar';

// ---------------------------------------------------------------------------
// Procesado de características
// ---------------------------------------------------------------------------

/** Qué se saca en una extracción. */
export type OperacionExtraccion =
  'dia' | 'mes' | 'anio' | 'hora' | 'minuto' | 'diaSemana' | 'subcadena';

/** Opciones para el desplegable de la pantalla. */
export const OPCIONES_EXTRACCION: { valor: OperacionExtraccion; texto: string }[] = [
  { valor: 'dia', texto: 'Día (DD)' },
  { valor: 'mes', texto: 'Mes (MM)' },
  { valor: 'anio', texto: 'Año (YYYY)' },
  { valor: 'hora', texto: 'Hora (HH)' },
  { valor: 'minuto', texto: 'Minuto (MIN)' },
  { valor: 'diaSemana', texto: 'Día de la semana (1 = lunes … 7 = domingo)' },
  { valor: 'subcadena', texto: 'Trozo de texto' },
];

/**
 * Una operación del procesado. `origen`, `a` y `b` pueden ser una columna de
 * datos o la columna del timestamp (por su nombre, p. ej. "timestamp").
 */
export type Operacion =
  | {
      tipo: 'extraer';
      origen: string;
      destino: string;
      op: OperacionExtraccion;
      /** Solo para 'subcadena': posición del primer carácter (desde 1) y cuántos. */
      inicio?: number;
      longitud?: number;
    }
  | { tipo: 'combinar'; a: string; b: string; destino: string }
  | { tipo: 'eliminar'; columna: string }
  | { tipo: 'anadir'; destino: string; valor: string };

/** El procesado del experimento del artículo (4.2.1), sobre la columna del timestamp. */
export function procesadoDelArticulo(columnaTimestamp: string): Operacion[] {
  return [
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'DD', op: 'dia' },
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'MM', op: 'mes' },
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'HH', op: 'hora' },
    { tipo: 'extraer', origen: columnaTimestamp, destino: 'MIN', op: 'minuto' },
  ];
}

/** Separador de la combinación: "zona1" + "bomba" => "zona1_bomba". */
export const SEPARADOR_COMBINACION = '_';

/** Partes de una fecha leídas del texto, sin zona horaria. */
interface PartesFecha {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
}

/**
 * Lee una fecha en los formatos que maneja la herramienta: ISO
 * (2026-10-01T00:15:00.000Z, también con espacio en vez de T) o el del
 * visualizador de Emilia (01/10/2026 00:15:00). Sin hora, la hora es 0.
 * Devuelve null si no es una fecha válida.
 */
export function leerFecha(texto: string): PartesFecha | null {
  const t = texto.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(t);
  let partes: PartesFecha | null = null;
  if (m) {
    partes = { anio: +m[1], mes: +m[2], dia: +m[3], hora: +(m[4] ?? 0), minuto: +(m[5] ?? 0) };
  } else {
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}))?/.exec(t);
    if (m) {
      partes = { anio: +m[3], mes: +m[2], dia: +m[1], hora: +(m[4] ?? 0), minuto: +(m[5] ?? 0) };
    }
  }
  if (!partes) {
    return null;
  }
  // Se comprueba que el día existe (que no sea un 31/02) volviendo a montar la fecha.
  const fecha = new Date(Date.UTC(partes.anio, partes.mes - 1, partes.dia));
  const valida =
    fecha.getUTCFullYear() === partes.anio &&
    fecha.getUTCMonth() === partes.mes - 1 &&
    fecha.getUTCDate() === partes.dia &&
    partes.hora < 24 &&
    partes.minuto < 60;
  return valida ? partes : null;
}

/** Aplica una extracción a un valor. Devuelve '' (un hueco) si no se puede. */
export function extraer(valor: string, op: OperacionExtraccion, inicio = 1, longitud = 1): string {
  if (valor === '') {
    return '';
  }
  if (op === 'subcadena') {
    return valor.substring(inicio - 1, inicio - 1 + longitud);
  }
  const f = leerFecha(valor);
  if (!f) {
    return '';
  }
  switch (op) {
    case 'dia':
      return String(f.dia);
    case 'mes':
      return String(f.mes);
    case 'anio':
      return String(f.anio);
    case 'hora':
      return String(f.hora);
    case 'minuto':
      return String(f.minuto);
    case 'diaSemana': {
      // getUTCDay da 0 = domingo … 6 = sábado; se pasa a 1 = lunes … 7 = domingo.
      const d = new Date(Date.UTC(f.anio, f.mes - 1, f.dia)).getUTCDay();
      return String(d === 0 ? 7 : d);
    }
  }
}

/**
 * Comprueba la lista de operaciones contra las columnas de la tabla, en orden
 * (cada operación ve las columnas que han dejado las anteriores).
 * Devuelve un mensaje de error, o null si todo está bien.
 */
export function validarOperaciones(
  operaciones: Operacion[],
  columnaTimestamp: string,
  columnas: string[],
): string | null {
  const existentes = new Set(columnas);
  const existe = (c: string) => c === columnaTimestamp || existentes.has(c);

  for (const [i, o] of operaciones.entries()) {
    const n = `Operación ${i + 1}`;
    if (o.tipo === 'eliminar') {
      if (!existentes.has(o.columna)) {
        return `${n}: no existe la columna "${o.columna}" (la del timestamp no se puede quitar).`;
      }
      existentes.delete(o.columna);
      continue;
    }
    const destino = o.destino.trim();
    if (destino === '') {
      return `${n}: falta el nombre de la característica nueva.`;
    }
    if (existe(destino)) {
      return `${n}: ya hay una columna llamada "${destino}".`;
    }
    if (o.tipo === 'extraer') {
      if (!existe(o.origen)) {
        return `${n}: no existe la columna "${o.origen}".`;
      }
      if (o.op === 'subcadena') {
        const entero = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 1;
        if (!entero(o.inicio) || !entero(o.longitud)) {
          return `${n}: el inicio y la longitud del trozo deben ser enteros de 1 en adelante.`;
        }
      }
    } else if (o.tipo === 'combinar') {
      if (!existe(o.a) || !existe(o.b)) {
        return `${n}: no existe la columna "${existe(o.a) ? o.b : o.a}".`;
      }
    }
    existentes.add(destino);
  }
  return null;
}

/**
 * Aplica las operaciones en orden y devuelve una tabla nueva (no modifica la de
 * entrada). Las características nuevas se añaden al final. Hay que validar antes
 * con validarOperaciones.
 */
export function procesarCaracteristicas(
  tabla: TablaPivotada,
  operaciones: Operacion[],
): TablaPivotada {
  let ids = [...tabla.ids];
  let filas = tabla.filas.map((f) => ({ timestamp: f.timestamp, valores: [...f.valores] }));

  /** Valor de una columna en una fila (la del timestamp también vale). */
  const leer = (columna: string): ((fila: (typeof filas)[number]) => string) => {
    if (columna === tabla.columnaTimestamp) {
      return (fila) => fila.timestamp;
    }
    const c = ids.indexOf(columna);
    return (fila) => fila.valores[c];
  };

  for (const o of operaciones) {
    if (o.tipo === 'eliminar') {
      const c = ids.indexOf(o.columna);
      ids = ids.filter((_, i) => i !== c);
      filas = filas.map((f) => ({ ...f, valores: f.valores.filter((_, i) => i !== c) }));
      continue;
    }
    let calcular: (fila: (typeof filas)[number]) => string;
    if (o.tipo === 'extraer') {
      const origen = leer(o.origen);
      calcular = (fila) => extraer(origen(fila), o.op, o.inicio, o.longitud);
    } else if (o.tipo === 'combinar') {
      const a = leer(o.a);
      const b = leer(o.b);
      calcular = (fila) => {
        const va = a(fila);
        const vb = b(fila);
        return va === '' || vb === '' ? '' : va + SEPARADOR_COMBINACION + vb;
      };
    } else {
      calcular = () => o.valor;
    }
    for (const fila of filas) {
      fila.valores.push(calcular(fila));
    }
    ids.push(o.destino.trim());
  }

  return { ...tabla, ids, filas };
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/**
 * Convierte el texto de una celda en número. Devuelve NaN si no lo es (y si
 * está vacío: Number('') daría 0).
 *
 * Acepta la coma decimal, porque Excel en español exporta así los CSV
 * (12,5 o 1,72E-02): si hay una sola coma y ningún punto, la coma es el
 * decimal. No hay separador de miles: "1.234,5" no es un número. Los formatos
 * del Excel de los datos (General y 0.0000) no lo usan.
 */
export function aNumero(texto: string): number {
  let t = texto.trim();
  if (t === '') {
    return NaN;
  }
  if (!t.includes('.') && t.indexOf(',') === t.lastIndexOf(',')) {
    t = t.replace(',', '.');
  }
  return Number(t);
}

/** true si el texto es un número (el vacío no cuenta: es un hueco). */
export function esNumero(texto: string): boolean {
  return Number.isFinite(aNumero(texto));
}

/**
 * Columnas con algún valor que no es un número (los huecos no cuentan). El
 * Isolation Forest solo trabaja con números, así que la tabla no puede tenerlas.
 */
export function columnasNoNumericas(tabla: TablaPivotada): string[] {
  return tabla.ids.filter((_, c) =>
    tabla.filas.some((f) => f.valores[c] !== '' && !esNumero(f.valores[c])),
  );
}

/** Lanza un error, con el nombre de las columnas, si alguna no es numérica. */
export function comprobarNumerica(tabla: TablaPivotada): void {
  const noNumericas = columnasNoNumericas(tabla);
  if (noNumericas.length === 0) {
    return;
  }
  const maximo = 12;
  const nombres =
    noNumericas.slice(0, maximo).join(', ') +
    (noNumericas.length > maximo ? ` y ${noNumericas.length - maximo} más` : '');
  const una = noNumericas.length === 1;
  throw new Error(
    `${una ? 'La columna' : 'Las columnas'} ${nombres} ${una ? 'tiene' : 'tienen'} ` +
      'valores que no son números. El Isolation Forest solo trabaja con números: ' +
      'revisa el CSV (por ejemplo, decimales mal escritos) o las operaciones del procesado.',
  );
}

// ---------------------------------------------------------------------------
// Preparación
// ---------------------------------------------------------------------------

export interface Preparacion {
  /** Operaciones del procesado de características, en orden. */
  operaciones: Operacion[];
}

/** Sin procesado: la tabla pasa tal cual. */
export const SIN_PREPARACION: Preparacion = { operaciones: [] };

export interface ResultadoPreparacion {
  tabla: TablaPivotada;
  /** Características que ha añadido el procesado. */
  columnasNuevas: string[];
}

/** Procesado de características. Lanza un error si una operación está mal puesta. */
export function prepararCaracteristicas(
  tabla: TablaPivotada,
  p: Preparacion,
): ResultadoPreparacion {
  const error = validarOperaciones(p.operaciones, tabla.columnaTimestamp, tabla.ids);
  if (error) {
    throw new Error(error);
  }
  const procesada = procesarCaracteristicas(tabla, p.operaciones);
  const antes = new Set(tabla.ids);
  return {
    tabla: procesada,
    columnasNuevas: procesada.ids.filter((id) => !antes.has(id)),
  };
}
