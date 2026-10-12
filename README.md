# RutaSur

Plataforma de seguimiento de envíos en tiempo real para un operador de última milla,
construida sobre una arquitectura orientada a eventos. Trabajo práctico de
Programación Avanzada (FCyT, 2026).

La especificación completa está en [`docs/spec.md`](docs/spec.md).

## Stack

- **Node.js >= 20** (ESM, JavaScript con JSDoc y `checkJs`).
- **Apache Kafka** (KRaft) como único punto de contacto entre servicios.
- **MongoDB** (replica set de un nodo) para vistas derivadas de lectura.
- **Next.js** para la interfaz (solo lee de MongoDB).

## Estructura del monorepo

```
packages/shared         Utilidades compartidas (esquemas de eventos, constantes, lógica pura)
services/simulador      Genera envíos, promesas y cambios de estado
services/proyector      Mantiene las vistas de lectura en MongoDB
services/notificaciones Registra avisos al destinatario ante fallos y alertas
services/reprogramacion Decide el próximo intento tras una entrega fallida
services/monitor-sla    Detecta envíos en riesgo y emite alertas de SLA
services/analitica      Actualiza los agregados de metricas_diarias
apps/web                Interfaz Next.js (placeholder por ahora)
docs/                   Especificación y registro de decisiones
```

## Requisitos

- Node.js 20 (ver `.nvmrc`; con `nvm`: `nvm use`).

## Puesta en marcha

```bash
npm install
npm run check   # lint + typecheck + tests
```

## Scripts raíz

| Comando              | Qué hace                                        |
| :------------------- | :---------------------------------------------- |
| `npm run lint`       | ESLint (exige JSDoc en clases y funciones)      |
| `npm run typecheck`  | `tsc --noEmit` con `checkJs` sobre todo el repo |
| `npm test`           | Tests (`node:test`) de todos los workspaces     |
| `npm run check`      | Los tres anteriores, en orden                   |

## Convenciones

- **Arquitectura:** Kafka es el único punto de contacto entre servicios; MongoDB
  guarda solo vistas derivadas; Next.js solo lee de MongoDB. Ver reglas
  permanentes en [`AGENTS.md`](AGENTS.md).
- **Identificadores de dominio en español** según la especificación
  (`shipmentId`, `ocurridoEn`, `secuencia`, etc.); comentarios y JSDoc en español.
- **JSDoc obligatorio** en toda clase, función, método y typedef; el lint falla si falta.
- **Commits:** Conventional Commits (`feat:`, `test:`, `chore:`, `docs:`, ...).
- **Configuración** por variables de entorno validadas al arrancar; sin números ni
  strings mágicos.
- Las decisiones técnicas se registran en [`docs/DECISIONES.md`](docs/DECISIONES.md).
