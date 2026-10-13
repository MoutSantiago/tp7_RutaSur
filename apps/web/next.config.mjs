/**
 * Configuración de Next.js para la interfaz de RutaSur.
 * La app solo lee de MongoDB (vistas derivadas), nunca de Kafka.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
