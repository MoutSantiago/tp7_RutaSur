import TrackingPublico from '../../components/TrackingPublico.jsx';
import { obtenerTrackingEnvio } from '../../../lib/mongo.js';

export const dynamic = 'force-dynamic';

/**
 * Página pública de tracking: solo estado actual y fecha estimada.
 * Jamás expone datos internos (repartidor, hub, zona, alertas, motivos).
 * @param {object} props Props de la página.
 * @param {Promise<{shipmentId: string}>} props.params Parámetros de la ruta.
 * @returns {Promise<import('react').ReactElement>} Vista pública de tracking.
 */
export default async function PaginaTracking({ params }) {
  const { shipmentId } = await params;
  const inicial = await obtenerTrackingEnvio(shipmentId);
  return <TrackingPublico shipmentId={shipmentId} inicial={inicial} />;
}
