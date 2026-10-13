import DetalleEnvio from '../../components/DetalleEnvio.jsx';
import { obtenerDetalleEnvio } from '../../../lib/mongo.js';

export const dynamic = 'force-dynamic';

/**
 * Página de detalle de un envío: línea de tiempo, intentos, alertas y
 * notificaciones. Renderiza el estado inicial en el servidor y el componente
 * cliente aplica los cambios que llegan por SSE filtrados por shipmentId.
 * @param {object} props Props de la página.
 * @param {Promise<{shipmentId: string}>} props.params Parámetros de la ruta.
 * @returns {Promise<import('react').ReactElement>} Página de detalle.
 */
export default async function PaginaDetalle({ params }) {
  const { shipmentId } = await params;
  const detalle = await obtenerDetalleEnvio(shipmentId);
  return (
    <DetalleEnvio
      shipmentId={shipmentId}
      envioInicial={detalle.envio}
      alertasIniciales={detalle.alertas}
      notificacionesIniciales={detalle.notificaciones}
    />
  );
}
