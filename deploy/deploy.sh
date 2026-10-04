#!/usr/bin/env bash
#
# Deploy do Codex do Aventureiro: reconstrói o cliente e o servidor e reinicia
# o serviço systemd.
#
# Fecha o ciclo que antes era manual (build + restart depois de cada alteração).
# O serviço `grimorio` roda `node dist/index.js` (NODE_ENV=production) e serve o
# bundle estático de `client/dist`; ele NÃO reconstrói nada sozinho.
#
# Uso:  bash deploy/deploy.sh   (ou  npm run deploy)
#
set -euo pipefail

# Raiz do projeto (este script vive em deploy/).
cd "$(dirname "$0")/.."

echo "==> Build do cliente (client/dist)"
npm run build:client

echo "==> Build do servidor (dist)"
npm run build

echo "==> Reiniciando o serviço grimorio"
if command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files grimorio.service >/dev/null 2>&1; then
  systemctl restart grimorio
  echo "    serviço reiniciado."
else
  echo "    systemd/grimorio indisponível — reinicie o processo manualmente (npm start)."
fi

echo "==> Deploy concluído."
