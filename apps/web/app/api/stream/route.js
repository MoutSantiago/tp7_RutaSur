/**
 * Route handler SSE: empuja al navegador los cambios de las colecciones
 * `envios` y `alertas` vía change streams de MongoDB.
 *
 * Cada cambio se emite como un evento `envio` o `alerta` con el documento
 * completo (fullDocument). El cliente reconecta solo (EventSource lo hace por
 * defecto); al desconectarse el navegador (`request.signal.abort`) se cierran
 * los change streams y se libera el heartbeat.
 */

import { obtenerDb } from '../../../lib/mongo.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Intervalo del heartbeat que mantiene viva la conexión (ms). */
const HEARTBEAT_MS = 15000;

/**
 * Maneja la conexión SSE del navegador.
 * @param {Request} request Petición entrante.
 * @returns {Promise<Response>} Respuesta `text/event-stream` con el flujo.
 */
export async function GET(request) {
  const db = await obtenerDb();
  const codificador = new TextEncoder();

  const flujo = new ReadableStream({
    start(controlador) {
      const cambiosEnvios = db
        .collection('envios')
        .watch([], { fullDocument: 'updateLookup' });
      const cambiosAlertas = db
        .collection('alertas')
        .watch([], { fullDocument: 'updateLookup' });
      const cambiosNotifs = db
        .collection('notificaciones')
        .watch([], { fullDocument: 'updateLookup' });

      /**
       * Emite un evento SSE con el documento serializado.
       * @param {string} tipo Tipo del evento ('envio' | 'alerta').
       * @param {import('mongodb').ChangeStreamDocument} cambio Documento de cambio.
       * @returns {void}
       */
      function enviar(tipo, cambio) {
        const doc = /** @type {Record<string, unknown> | null} */ (
          'fullDocument' in cambio ? cambio.fullDocument : null
        );
        if (!doc) return;
        const { _id, ...sinId } = doc;
        try {
          controlador.enqueue(
            codificador.encode(`event: ${tipo}\ndata: ${JSON.stringify(sinId)}\n\n`),
          );
        } catch {
          // El controlador está cerrado: se limpia en abort.
        }
      }

      cambiosEnvios.on('change', (/** @type {import("mongodb").ChangeStreamDocument} */ cambio) => enviar('envio', cambio));
      cambiosAlertas.on('change', (/** @type {import("mongodb").ChangeStreamDocument} */ cambio) => enviar('alerta', cambio));
      cambiosNotifs.on('change', (/** @type {import("mongodb").ChangeStreamDocument} */ cambio) => enviar('notificacion', cambio));
      cambiosEnvios.on('error', () => cerrar());

      const heartbeat = setInterval(
        () => controlador.enqueue(codificador.encode(`: ping\n\n`)),
        HEARTBEAT_MS,
      );

      /**
       * Cierra streams y heartbeat cuando el cliente se desconecta.
       * @returns {void}
       */
      function cerrar() {
        clearInterval(heartbeat);
        cambiosEnvios.close().catch(() => {});
        cambiosAlertas.close().catch(() => {});
        cambiosNotifs.close().catch(() => {});
        try {
          controlador.close();
        } catch {
          // ya cerrado
        }
      }

      request.signal.addEventListener('abort', cerrar, { once: true });
    },
  });

  return new Response(flujo, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
