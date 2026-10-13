import TorreControl from './components/TorreControl.jsx';
import {
  obtenerContadoresPorEstado,
  obtenerAlertasAbiertas,
  obtenerUltimosEnvios,
} from '../lib/mongo.js';

export const dynamic = 'force-dynamic';

/**
 * Página de la torre de control: renderiza en el servidor el estado inicial
 * (contadores por estado, cola de alertas priorizada y últimos envíos) y lo
 * entrega al componente cliente, que aplica los cambios que llegan por SSE.
 * @returns {Promise<import('react').ReactElement>} Página de la torre de control.
 */
export default async function PaginaTorre() {
  const [contadores, alertas, ultimos] = await Promise.all([
    obtenerContadoresPorEstado(),
    obtenerAlertasAbiertas(),
    obtenerUltimosEnvios(),
  ]);
  return <TorreControl contadoresIniciales={contadores} alertasIniciales={alertas} ultimosIniciales={ultimos} />;
}
