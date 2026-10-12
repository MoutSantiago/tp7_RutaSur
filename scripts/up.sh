#!/usr/bin/env bash
# scripts/up.sh — Levanta el entorno Docker de RutaSur y espera a que los
# servicios de inicialización (topics de Kafka y replica set de MongoDB)
# terminen con éxito.
#
# Uso: npm run up
# Códigos de salida: 0 si todo quedó listo; 1 si algún init falló o hay timeout.

set -euo pipefail

TIMEOUT_SEGUNDOS="${RUTASUR_UP_TIMEOUT:-180}"
INITS=(kafka-init-topics mongodb-init-rs)

docker compose up -d

echo 'Esperando a que finalicen los servicios de inicialización...'
transcurrido=0
for servicio in "${INITS[@]}"; do
  while :; do
    if cid=$(docker compose ps -a -q "$servicio" 2>/dev/null) && [[ -n "$cid" ]]; then
      estado=$(docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' "$cid")
      if [[ "$estado" == exited\ * ]]; then
        codigo="${estado#exited }"
        if [[ "$codigo" != "0" ]]; then
        echo "ERROR: $servicio terminó con código $codigo" >&2
          docker compose logs "$servicio" >&2
          exit 1
        fi
        break
      fi
    fi
    if ((transcurrido >= TIMEOUT_SEGUNDOS)); then
      echo "ERROR: timeout esperando a $servicio" >&2
      exit 1
    fi
    sleep 2
    transcurrido=$((transcurrido + 2))
  done
done

docker compose logs --tail=20 "${INITS[@]}"
echo 'Entorno RutaSur listo.'
