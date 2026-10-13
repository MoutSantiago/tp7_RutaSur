/**
 * SSE público de tracking para UN envío: emite solo la vista saneada
 * (`sanearTracking`), ningún dato interno. El cliente reconoce la conexión
 * cortada y EventSource reconecta automáticamente.
 */

import { obtenerDb } from '../../../../../lib/mongo.js';
import { sanearTracking } from '../../../../../lib/tracking.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Intervalo del heartbeat que mantiene viva la conexión (ms). */
const HEARTBEAT_MS = 15000;

/**
 * Maneja la conexión SSE del tracking público.
 * @param {Request} request Petición entrante.
 * @param {object} contexto Contexto de la ruta.
 * @param {Promise<{shipmentId: string}>} contexto.params Parámetros de la ruta.
 * @returns {Promise<Response>} Respuesta `text/event-stream` con eventos `tracking`.
 */
export async function GET(request, { params }) {
  const { shipmentId } = await params;
  const db = await obtenerDb();
  const codificador = new TextEncoder();

  const flujo = new ReadableStream({
    start(controlador) {
      // Change stream limitado al envío pedido mediante pipeline.
      const stream = db.collection('envios').watch(
        [{ $match: { 'fullDocument.shipmentId': shipmentId } }],
        { fullDocument: 'updateLookup' },
      );
      stream.on('change', (cambio) => {
        const doc = 'fullDocument' in cambio ? cambio.fullDocument : null;
        if (!doc) return;
        const publico = sanearTracking(/** @type {Record<string, unknown>} */ (doc));
        try {
          controlador.enqueue(
            codificador.encode(`event: tracking\ndata: ${JSON.stringify(publico)}\n\n`),
          );
        } catch {
          // cliente desconectado; se limpia en abort
        }
      });
      const heartbeat = setInterval(
        () => controlador.enqueue(codificador.encode(`: ping\n\n`)),
        HEARTBEAT_MS,
      );

      const cerrar = () => {
        clearInterval(heartbeat);
        stream.close().catch(() => {});
        try {
          controlador.close();
        } catch {
          // ya cerrado
        }
      };
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
