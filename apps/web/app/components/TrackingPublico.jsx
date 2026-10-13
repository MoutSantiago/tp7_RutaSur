'use client';

import { useEffect, useState } from 'react';

/**
 * Vista pública de tracking: estado actual y fecha estimada, en vivo por SSE.
 * Solo recibe los campos saneados del envío; no muestra nada interno.
 * @param {object} props Props del componente.
 * @param {string} props.shipmentId Identificador del envío.
 * @param {object | null} props.inicial Vista pública inicial (SSR; null si no existe).
 * @returns {import('react').ReactElement} Vista pública de tracking.
 */
export default function TrackingPublico({ shipmentId, inicial }) {
  /** @type {[Record<string, any> | null, Function]} */
  const [tracking, setTracking] = useState(inicial);
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    const fuente = new EventSource(`/api/tracking/${encodeURIComponent(shipmentId)}/stream`);
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false); // EventSource reconecta solo
    fuente.addEventListener('tracking', (mensaje) => {
      setTracking(JSON.parse(mensaje.data));
    });
    return () => fuente.close();
  }, [shipmentId]);

  if (!tracking) {
    return (
      <section className="panel">
        <h2>Envío no encontrado</h2>
        <p>
          No encontramos ningún envío con el código <code>{shipmentId}</code>. Verificá el link de
          seguimiento que te envió el comercio.
        </p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>
        Seguimiento de tu envío{' '}
        <span className={conectado ? 'aviso-vivo' : 'aviso-cortado'}>
          {conectado ? '● en vivo' : '○ reconectando…'}
        </span>
      </h2>
      <p>
        <strong>{tracking.shipmentId}</strong>
      </p>
      <p className="estado-grande">{tracking.estadoTexto}</p>
      {tracking.fechaEstimada && (
        <p>
          Entrega estimada: {tracking.fechaEstimada.slice(0, 10)}
          {tracking.franjaEstimada ? ` (franja ${tracking.franjaEstimada})` : ''}
        </p>
      )}
    </section>
  );
}
