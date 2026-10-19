import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';

// Configuración general de Angular. Son los dos ajustes que trae el proyecto por defecto.
// No hay router porque la app es una sola página.
export const appConfig: ApplicationConfig = {
  providers: [
    // Recoge los errores que no hemos capturado en ningún try/catch y los saca por consola.
    provideBrowserGlobalErrorListeners(),
    // Zone.js es lo que usa Angular para saber cuándo tiene que repintar.
    // Con eventCoalescing, si llegan varios eventos seguidos se repinta una sola vez.
    provideZoneChangeDetection({ eventCoalescing: true }),

  ]
};
