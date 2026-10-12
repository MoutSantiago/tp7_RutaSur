REGLAS PERMANENTES DEL PROYECTO RutaSur
Contexto completo: docs/spec.md (leerlo ante cualquier duda de alcance).

Stack: Node.js (>=20, ESM, JavaScript con JSDoc y checkJs/tsc --noEmit),
Apache Kafka (KRaft), MongoDB (replica set de un nodo), Next.js, Docker Compose.

Arquitectura (innegociable):
- Kafka es el único punto de contacto entre servicios; ninguno llama a otro directamente.
- MongoDB guarda solo vistas derivadas; Next.js solo lee de MongoDB.
- Cada servicio es un proceso Node.js separado, con su propio grupo de consumidores.
- Entrega "al menos una vez" + consumidores idempotentes; commit manual de offsets
  DESPUÉS de escribir en MongoDB.
- Clave de partición siempre shipmentId. Eventos en JSON con validación de esquema.

Buenas prácticas obligatorias:
- JSDoc en TODA clase, función, método y typedef: descripción, @param, @returns,
  @throws cuando corresponda y @example en lo no trivial. Sin excepciones.
- ESLint + Prettier + eslint-plugin-jsdoc (regla que EXIGE JSDoc) y los checks deben pasar.
- Funciones pequeñas y de una sola responsabilidad; separar lógica pura de I/O
  (la lógica de negocio debe poder testearse sin Kafka ni Mongo).
- Sin números ni strings mágicos: constantes con nombre y configuración por variables de
  entorno validadas al arrancar.
- Manejo explícito de errores, sin catch vacíos; logs estructurados (JSON) con eventId,
  partición y offset en los consumidores.
- Apagado ordenado (SIGTERM/SIGINT): cerrar consumidores, productores y conexiones.
- Tests automáticos para cada regla de negocio; nombres descriptivos.
- Comentarios y JSDoc en español; identificadores de dominio según la especificación
  (shipmentId, ocurridoEn, secuencia, etc.).
- Sin dependencias innecesarias; no agregar nada fuera del alcance de la especificación.

Flujo de trabajo por paso:
1) Implementar SOLO lo pedido en el paso, sin adelantar pasos futuros.
2) Ejecutar lint, chequeo de tipos y tests; todos deben pasar.
3) Actualizar README.md con lo agregado y cómo verificarlo.
4) Commit con Conventional Commits (feat:, test:, chore:, docs:), commits pequeños
   dentro del paso si conviene, y un commit final del paso.
5) Informar qué se hizo, cómo verificarlo y qué decisiones tomó.
