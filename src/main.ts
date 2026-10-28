// Punto de entrada de la app. Es lo primero que se ejecuta al abrir la página.
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Arrancamos Angular con el componente raíz (App) y la configuración de app.config.ts.
// Si algo peta al arrancar, al menos que salga en la consola del navegador.
bootstrapApplication(App, appConfig).catch((err) => console.error(err));
