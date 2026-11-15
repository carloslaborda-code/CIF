import { Component, ElementRef, input, model, viewChildren } from '@angular/core';

export interface Pestana {
  id: string;
  texto: string;
}

/**
 * Fila de pestañas. Solo pinta los botones; el contenido lo pone quien la usa,
 * en un elemento con role="tabpanel", id "panel-<id>" y aria-labelledby "pestana-<id>".
 *
 * Sigue el patrón habitual de teclado: con el tabulador se entra en la pestaña
 * activa y con las flechas (o Inicio y Fin) se cambia de una a otra.
 */
@Component({
  selector: 'app-pestanas',
  // El elemento del componente es un bloque y separa a sus hijos entre sí.
  host: { class: 'block' },
  template: `
    <div
      role="tablist"
      [attr.aria-label]="nombre()"
      class="flex gap-1 overflow-x-auto border-b border-slate-300"
    >
      @for (p of pestanas(); track p.id) {
        <button
          #boton
          type="button"
          role="tab"
          [id]="'pestana-' + p.id"
          [attr.aria-selected]="p.id === activa()"
          [attr.aria-controls]="'panel-' + p.id"
          [tabindex]="p.id === activa() ? 0 : -1"
          class="whitespace-nowrap rounded-t-lg border-b-4 px-4 py-2.5 text-sm font-medium transition-colors"
          [class]="
            p.id === activa()
              ? 'border-blue-700 bg-white text-blue-900'
              : 'border-transparent text-slate-700 hover:bg-slate-200'
          "
          (click)="activa.set(p.id)"
          (keydown)="alPulsar($event, $index)"
        >
          {{ p.texto }}
        </button>
      }
    </div>
  `,
})
export class Pestanas {
  /** Nombre del grupo de pestañas, para los lectores de pantalla. */
  readonly nombre = input.required<string>();
  readonly pestanas = input.required<Pestana[]>();
  /** Id de la pestaña activa, enlazado en los dos sentidos con el padre. */
  readonly activa = model.required<string>();

  private readonly botones = viewChildren<ElementRef<HTMLButtonElement>>('boton');

  protected alPulsar(evento: KeyboardEvent, i: number): void {
    const ultimo = this.pestanas().length - 1;
    const destinos: Record<string, number> = {
      ArrowRight: i === ultimo ? 0 : i + 1,
      ArrowLeft: i === 0 ? ultimo : i - 1,
      Home: 0,
      End: ultimo,
    };
    if (evento.key in destinos) {
      evento.preventDefault();
      const destino = destinos[evento.key];
      this.activa.set(this.pestanas()[destino].id);
      this.botones()[destino].nativeElement.focus();
    }
  }
}
