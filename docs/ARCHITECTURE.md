# Arquitectura paper/live

## Estado operativo actual

La persistencia usa migraciones idempotentes de configuración y estado; los respaldos de una versión futura se rechazan antes de restaurarse.

El paper actual ejecuta stops y take-profit desde ticks y rangos OHLC. Un gap se llena al `open` de la vela y conserva `protectionGap: true` en la evidencia del fill. Si el feed está offline no se inventa un precio: las entradas permanecen bloqueadas y una protección persistida espera una cotización fresca.

Este documento describe la arquitectura objetivo. El alcance, estado actual y criterios de aceptación se detallan en PRODUCT_SCOPE.md. Los módulos separados de broker y riesgo aún requieren implementación completa; el paper actual sí ejecuta stops y take-profit desde ticks y rangos OHLC. Si el feed está offline no inventa un fill y espera una cotización fresca.

## Flujo común

```text
MarketDataProvider
       ↓
FeatureEngine + NewsContext
       ↓
LLM Analyst → TradeIntent estructurada
       ↓
RiskGovernor determinista
       ↓
PaperBroker o LiveBroker
       ↓
PortfolioLedger + Metrics + AuditLog
```

El modelo puede proponer `BUY`, `SELL` o `HOLD`, tamaño máximo, entrada, stop, take-profit, horizonte y razones. No puede decidir por sí solo el tamaño final ni saltarse el `RiskGovernor`.

## Paper mode (V1 y siguiente iteración)

- Usa precios reales por WebSocket, pero no envía órdenes a un exchange.
- V1 simula comisión, slippage, saldo, rechazos básicos y fills completos; el siguiente paso añade bid/ask, latencia y fills parciales parametrizables.
- Marca posiciones a mercado en cada tick.
- Mantiene equity, cash, exposición, P&L realizado/no realizado y drawdown.
- Permite reiniciar la cuenta con un capital inicial, por ejemplo `$100`.
- La siguiente iteración añadirá comparación contra buy-and-hold y una cuenta sin operar.
- Auto-Paper es opcional y nace desactivado; cuando se activa, el scheduler llama al LLM con cooldown y el `RiskGovernor` calcula el tamaño antes de enviar la orden al `PaperBroker`.

## Live mode futuro

`LiveBroker` tendrá un adaptador por proveedor y el mismo contrato que `PaperBroker`: saldo, posiciones, cotizaciones, enviar/cancelar orden, eventos de fill y reconciliación. Las credenciales del broker serán independientes de las del LLM y tendrán permisos mínimos; el modo se activará mediante una acción explícita separada.

Antes de habilitarlo deben existir: sandbox/testnet, confirmación de cuenta y símbolo, límites pre-trade, kill switch, idempotencia, reintentos seguros, reconciliación contra el broker, registro de auditoría y alertas.

## Qué significa “mejora”

No se mide solo por saldo final. Cada experimento debe guardar versión de prompt/modelo, datos, horario de decisión, fills, fees y slippage. El reporte debe mostrar retorno neto, benchmark, volatilidad, drawdown máximo, Sharpe/Sortino, win rate, profit factor, expectancy, turnover, exposición y número de trades.
