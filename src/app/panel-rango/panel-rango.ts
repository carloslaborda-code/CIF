import { Component, input, linkedSignal, output } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { esSinRango, RangoRegistros, SIN_RANGO, validarRango } from '../core/logica/rango';

/**
 * Rango de registros: desde qué registro hasta cuál se analiza (rango.ts).
 *
 * Se usa así:
 *   <app-panel-rango [rango]="..." [numRegistros]="..." (aplicar)="..." />
 *
 * Igual que el filtro, los campos se editan en un borrador y el rango solo se
 * aplica (y se rehace la tabla) al pulsar el botón. Un campo vacío es "sin límite".
 */
@Component({
  selector: 'app-panel-rango',
  host: { class: 'block space-y-3' },
  imports: [FormsModule],
  templateUrl: './panel-rango.html',
})
export class PanelRango {
  /** Rango aplicado ahora mismo. */
  readonly rango = input.required<RangoRegistros>();
  /** Registros que tiene la tabla entera (antes del rango), si se sabe. */
  readonly numRegistros = input<number | null>(null);
  /** Se emite al pulsar "Aplicar rango" o "Toda la tabla". */
  readonly aplicar = output<RangoRegistros>();

  /** Copia editable; se reinicia cuando cambia el rango aplicado. */
  protected readonly borrador = linkedSignal<RangoRegistros>(() => ({ ...this.rango() }));

  protected readonly esSinRango = esSinRango;

  /** El borrador con los campos vacíos como null (ngModel deja null o ''). */
  private limpio(): RangoRegistros {
    const v = (x: number | null | string) => (x === '' || x === null ? null : Number(x));
    return { desde: v(this.borrador().desde), hasta: v(this.borrador().hasta) };
  }

  /** Error del borrador, o null si se puede aplicar. */
  protected error(): string | null {
    return validarRango(this.limpio(), this.numRegistros() ?? undefined);
  }

  /** true si el borrador no es lo aplicado. */
  protected pendiente(): boolean {
    return JSON.stringify(this.limpio()) !== JSON.stringify(this.rango());
  }

  /** Cuántos registros entran con el borrador, si se sabe. */
  protected registrosQueEntran(): number | null {
    const n = this.numRegistros();
    if (n === null || this.error() !== null) {
      return null;
    }
    const r = this.limpio();
    return (r.hasta ?? n) - (r.desde ?? 1) + 1;
  }

  /** ngModel cambia el objeto por dentro; con esto el signal se entera. */
  protected refrescar(): void {
    this.borrador.update((r) => ({ ...r }));
  }

  protected alAplicar(): void {
    if (this.error() === null && this.pendiente()) {
      this.aplicar.emit(this.limpio());
    }
  }

  protected todaLaTabla(): void {
    this.aplicar.emit({ ...SIN_RANGO });
  }
}
