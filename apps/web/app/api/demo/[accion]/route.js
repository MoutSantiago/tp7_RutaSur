/**
 * Route handler del panel de demo: el navegador llama acá y el servidor
 * reenvía el comando a la API de control del simulador. Así el panel no
 * depende directamente del simulador ni de Kafka.
 */

import { dispararEscenario, inyectarMalformado } from '../../../../lib/simulador.js';

export const dynamic = 'force-dynamic';

/**
 * Dispara una acción del panel de demo.
 * @param {Request} request Petición POST.
 * @param {object} contexto Contexto de la ruta.
 * @param {Promise<{accion: string}>} contexto.params Acción: un escenario o "malformado".
 * @returns {Promise<Response>} Resultado JSON del comando.
 */
export async function POST(request, { params }) {
  const { accion } = await params;
  if (request.method !== 'POST') {
    return Response.json({ error: 'Solo POST' }, { status: 405 });
  }
  try {
    const datos =
      accion === 'malformado' ? await inyectarMalformado() : await dispararEscenario(accion);
    return Response.json({ ok: true, accion, ...datos });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : String(error);
    return Response.json({ ok: false, accion, error: mensaje }, { status: 502 });
  }
}
