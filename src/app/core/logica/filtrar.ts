/**
 * Filtro de lecturas por tipo (name), sensor (uid) y aulario (alias).
 *
 * Se aplica a las lecturas ya leídas del CSV, antes de pivotar, así la tabla,
 * los contextos y el CIF solo trabajan con lo elegido.
 *
 * - Dentro de un mismo campo vale cualquiera de los valores marcados (O).
 * - Entre campos distintos se tienen que cumplir todos (Y).
 *   Ejemplo: aulario "Aulario 1.1" o "Aulario 1.2", y tipo "coldWater".
 */
import * as Papa from 'papaparse';

import { nombreColumna, TIPO_DESCONOCIDO } from './fusionar';
import type { Lectura } from './pivotar';

/** Campos por los que se puede filtrar. */
export type CampoFiltro = 'tipos' | 'ids' | 'alias';

/**
 * Valores que se dejan pasar en cada campo. null = todos (sin filtro).
 * Se guardan los valores elegidos (y no los quitados) para que, con otro CSV
 * que tenga más sensores, salga exactamente la misma selección.
 */
export type FiltroLecturas = Record<CampoFiltro, string[] | null>;

export const SIN_FILTRO: FiltroLecturas = { tipos: null, ids: null, alias: null };

/** Un valor de la lista de un campo, con cuántas lecturas tiene. */
export interface OpcionFiltro {
  valor: string;
  lecturas: number;
  /** Texto de ayuda: para cada uid, su alias. */
  detalle: string;
}

export type OpcionesFiltro = Record<CampoFiltro, OpcionFiltro[]>;

/** Valor de una lectura en un campo. Sin tipo cuenta como "sin_tipo", igual que al fusionar. */
export function valorDeCampo(lectura: Lectura, campo: CampoFiltro): string {
  if (campo === 'tipos') {
    return lectura.tipo || TIPO_DESCONOCIDO;
  }
  return campo === 'ids' ? lectura.id : lectura.alias;
}

/** Valores distintos de cada campo con su número de lecturas, ordenados "naturalmente". */
export function opcionesDeFiltro(lecturas: Lectura[]): OpcionesFiltro {
  const contar = (campo: CampoFiltro): OpcionFiltro[] => {
    const porValor = new Map<string, OpcionFiltro>();
    for (const lectura of lecturas) {
      const valor = valorDeCampo(lectura, campo);
      let opcion = porValor.get(valor);
      if (!opcion) {
        opcion = { valor, lecturas: 0, detalle: campo === 'ids' ? lectura.alias : '' };
        porValor.set(valor, opcion);
      }
      opcion.lecturas++;
    }
    return [...porValor.values()].sort((a, b) =>
      a.valor.localeCompare(b.valor, undefined, { numeric: true }),
    );
  };
  return { tipos: contar('tipos'), ids: contar('ids'), alias: contar('alias') };
}

/**
 * Filtro que corresponde a lo marcado en cada lista: null si están marcadas
 * todas las opciones, y si no, las marcadas en el orden de la lista.
 *
 * Solo cuentan los valores marcados que existen en las opciones: un filtro
 * cargado de un JSON puede traer valores de otro CSV, y si se contaran, el
 * campo podría parecer "todo marcado" sin estarlo.
 */
export function filtroDeSeleccion(
  opciones: OpcionesFiltro,
  seleccion: Record<CampoFiltro, Set<string>>,
): FiltroLecturas {
  const deCampo = (campo: CampoFiltro) => {
    const marcados = opciones[campo].map((o) => o.valor).filter((v) => seleccion[campo].has(v));
    return marcados.length === opciones[campo].length ? null : marcados;
  };
  return { tipos: deCampo('tipos'), ids: deCampo('ids'), alias: deCampo('alias') };
}

/** Lecturas que pasan el filtro. */
export function aplicarFiltro(lecturas: Lectura[], filtro: FiltroLecturas): Lectura[] {
  // Sets para buscar rápido: con decenas de miles de lecturas, includes() en arrays sería lento.
  const campos = (Object.keys(filtro) as CampoFiltro[])
    .filter((campo) => filtro[campo] !== null)
    .map((campo) => ({ campo, permitidos: new Set(filtro[campo]) }));
  if (campos.length === 0) {
    return lecturas;
  }
  return lecturas.filter((l) =>
    campos.every(({ campo, permitidos }) => permitidos.has(valorDeCampo(l, campo))),
  );
}

/** true si el filtro deja pasar todo. */
export function esSinFiltro(filtro: FiltroLecturas): boolean {
  return filtro.tipos === null && filtro.ids === null && filtro.alias === null;
}

/**
 * Alias de cada columna de la tabla fusionada (tipo_id), para enseñarlo al
 * lado del nombre de la columna. Las columnas sin alias no aparecen.
 */
export function etiquetasDeColumnas(lecturas: Lectura[]): Record<string, string> {
  const etiquetas: Record<string, string> = {};
  for (const l of lecturas) {
    if (l.alias !== '') {
      etiquetas[nombreColumna(l.tipo || TIPO_DESCONOCIDO, l.id)] = l.alias;
    }
  }
  return etiquetas;
}

/**
 * CSV que explica cada columna de la tabla fusionada: columna; tipo; uid; aulario.
 * Va aparte de 2_fusionado.csv para no cambiar su formato (lo lee el visualizador
 * de Emilia), y con ';' como él para que Excel los abra igual.
 */
export function columnasACsv(columnas: string[], lecturas: Lectura[]): string {
  const info = new Map<string, { tipo: string; id: string; alias: string }>();
  for (const l of lecturas) {
    const tipo = l.tipo || TIPO_DESCONOCIDO;
    const columna = nombreColumna(tipo, l.id);
    if (!info.has(columna)) {
      info.set(columna, { tipo, id: l.id, alias: l.alias });
    }
  }
  return Papa.unparse(
    {
      fields: ['columna', 'tipo', 'uid', 'aulario'],
      data: columnas.map((c) => {
        const i = info.get(c);
        return [c, i?.tipo ?? '', i?.id ?? '', i?.alias ?? ''];
      }),
    },
    { delimiter: ';' },
  );
}
