# LLM Trader — plan maestro de plataforma

Este documento define el alcance completo. La lista operativa detallada está en TODO.md y las reglas de trabajo están en AGENTS.md.

## Objetivo

Crear una plataforma Electron para investigar mercados, probar estrategias con capital virtual y, solo cuando existan resultados reproducibles y controles verificados, conectar cuentas reales. La rentabilidad debe medirse después de comisiones, spread, slippage, datos, coste del LLM y errores operativos.

## Arquitectura común

Market Data → Feature Engine → Strategy/Agents → Trade Intent → Portfolio Construction → Risk Governor → PaperBroker/LiveBroker → Ledger → Metrics → Audit/Alerts.

El LLM propone una intención estructurada. El código calcula tamaño, valida saldo y exposición, ejecuta stops y decide si una orden se permite. Ningún LLM recibe credenciales de broker ni puede saltarse el motor de riesgo.

## Workspaces

### Simulación / Paper

Mercado real o histórico con dinero virtual, capital configurable y sesiones aisladas. Debe tener velas, volumen, indicadores, órdenes con estados, fills, bid/ask, spread, fees, slippage, latencia, stops, take-profit, equity, P&L, drawdown, Auto-Paper, pausa y kill switch.

### Real

Visible pero bloqueado hasta completar simulación, evaluación y sandbox. Requiere LiveBroker separado, credenciales por cuenta, permisos mínimos, vista read-only, reconciliación, idempotencia, auditoría, límites pre-trade, kill switch y activación explícita.

### Investigación

Backtest, replay, benchmarks, comparación y reportes sin generar órdenes. Debe respetar el tiempo disponible y evitar look-ahead bias.

## Módulos de plataforma

1. Shell Electron, configuración, migraciones, backups, diagnóstico y actualización.
2. Catálogo de instrumentos, precisión, mínimos, moneda, horarios y capacidades.
3. Datos históricos y tiempo real, cache, validación de huecos, timestamps, stale/offline y rate limits.
4. Terminal de velas, volumen, indicadores, crosshair, niveles, watchlist, órdenes y posiciones.
5. OMS con estados created, accepted, rejected, partial, filled, cancelled, expired y failed.
6. Ledger de doble entrada con cash reservado, coste medio, lotes, cierres parciales, comisiones y conversiones.
7. RiskGovernor con riesgo por operación, concentración, exposición, pérdida diaria, drawdown, spread, liquidez y circuit breakers.
8. PaperBroker y LiveBroker con el mismo contrato.
9. Estrategias versionadas, replay, backtest, walk-forward y Monte Carlo.
10. Métricas de retorno bruto/neto, fees, slippage, coste LLM, drawdown, recuperación, win rate, payoff, expectancy, profit factor, turnover, Sharpe, Sortino, beta y atribución.
11. Agentes técnico, noticias, fundamental, cartera y crítico, con presupuesto, timeout, deduplicación y evaluación.
12. Automatización con start, pause, resume, stop, heartbeat, alertas y recuperación.
13. Seguridad de secretos, IPC, permisos, auditoría y activación live.
14. Tests del ledger, fills, stops, gaps, stale, rate limits, reinicio, doble orden, riesgo y recuperación.

## Agentes

La primera estrategia debe usar un analista LLM y un motor cuantitativo local. Los indicadores y cálculos no deben depender de texto generado. Después se pueden probar:

- Técnico: interpreta indicadores calculados por código.
- Noticias: extrae hechos con fuente, fecha, activo, relevancia y horizonte.
- Fundamental: resultados y valoración para equities.
- Cartera: detecta concentración, correlación y conflictos.
- Crítico: busca datos contradictorios e invalida una tesis.

Agregar agentes solo cuenta como mejora si supera al agente único con el mismo dataset, periodo, presupuesto y costes.

## Evaluación económica

Cada experimento fija antes de comenzar universo, periodo, timeframe, prompt, modelo, costes, benchmark y criterio de éxito. Se compara contra cash, buy-and-hold y una estrategia simple.

Debe separar resultado bruto, comisiones, spread, slippage, coste del LLM, coste de datos y resultado neto. Debe mostrar drawdown, tiempo bajo agua, muestra y decisiones descartadas. Sin observaciones suficientes debe mostrar N/D.

Los backtests deben separar train, validation y test, usar walk-forward, evitar look-ahead bias y conservar dataset y supuestos. El paper prospectivo valida el proceso; no demuestra por sí solo rentabilidad.

## Fases

1. Simulación contable: ledger, coste medio, cierres parciales, órdenes con estados e invariantes.
2. Ejecución realista: bid/ask, spread, latencia, fills parciales, restricciones y gaps.
3. Terminal y riesgo: indicadores, P&L, equity, stops, take-profit, stale, pérdida diaria, drawdown, pausa y kill switch.
4. Investigación: replay, backtesting, benchmarks, métricas y reportes reproducibles.
5. Agentes: técnico, noticias, crítico, cartera, orquestador, presupuesto y evaluación.
6. Sandbox: un proveedor, read-only, órdenes sandbox, reconciliación y desconexiones.
7. Live controlado: habilitación por cuenta, límites, monitorización y apagado seguro.
8. Operación mantenida: servicio persistente, heartbeat, backups, alertas y runbook.

## Criterios antes de live

- Contabilidad paper correcta en compras, ventas, fees, cierres parciales y reinicios.
- Órdenes con estados, idempotencia y reconciliación.
- Stops, take-profit y límites probados con gaps y desconexión.
- Métricas netas comparadas contra benchmarks.
- Resultados fuera de muestra conservados sin reajustar el criterio.
- Sandbox probado con fills, rechazos y errores.
- Credenciales separadas y permisos mínimos.
- Kill switch y alertas comprobados.

## Prioridad actual

Completar simulación antes de activar datos avanzados, noticias o cuentas reales. TODO.md contiene las tareas concretas y marca el avance.

## Referencias

- https://www.quantconnect.com/docs/v1/algorithm-framework/overview
- https://www.quantconnect.com/docs/v1/algorithm-framework/execution
- https://www.quantconnect.com/docs/v1/algorithm-reference/trading-and-orders
- https://www.quantconnect.com/docs/v2/cloud-platform/backtesting/results
- https://docs.alpaca.markets/us/docs/paper-trading
- https://github.com/binance/binance-spot-api-docs
