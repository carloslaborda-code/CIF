import { Component } from '@angular/core';

import { PaginaPrincipal } from './pagina-principal/pagina-principal';

/** Componente raíz: solo muestra la página principal (no hay rutas). */
@Component({
  // Es el <app-root> que hay en index.html
  selector: 'app-root',
  // Como son componentes standalone, hay que importar aquí lo que se usa en el template
  imports: [PaginaPrincipal],
  // No tiene HTML propio, simplemente pinta la página principal
  template: '<app-pagina-principal />',
})
export class App {}
