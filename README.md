# LLM Trader

Base Electron para investigar mercados con un LLM y practicar estrategias en paper trading.

La simulación revisada incluye fallback REST, ledger reconciliado, controles de pausa/reanudación y terminal de operaciones. Consulta [la guía de uso](docs/SIMULATION_GUIDE.md) para empezar con 100 USDT virtuales, conocer los límites y activar Auto-Paper.

## V1 implementada

- Dashboard de cash, posiciones y trades simulados.
- Datos públicos OHLCV desde Binance.
- Análisis con cualquier endpoint compatible con OpenAI Chat Completions.
- API key guardada mediante `safeStorage` de Electron; nunca llega al renderer.
- Confirmación humana antes de ejecutar una orden paper.
- Estado local en la carpeta de datos de Electron, no en el repositorio.
- Workspace Real separado, Spot Binance sandbox/demo y órdenes manuales mainnet bajo sesión, límites y confirmación por orden.
- Feed de precios en tiempo real para actualizar el valor de las posiciones paper.
- Order book REST con spread, liquidez e imbalance para enriquecer el análisis.
- Auto-Paper opcional: analiza con intervalo y confianza mínima, calcula tamaño por riesgo y ejecuta solo dentro del broker simulado.
- Flujo multiagente: agente técnico, noticias, crítico, cartera y consenso antes del motor de riesgo.
- Presupuesto diario de llamadas/coste del LLM y pausa automática de Auto-Paper tras fallos repetidos.
- Auditoría de broker con hash encadenado y recuperación de órdenes conocidas tras desconexión.
- Respaldos automáticos de la cuenta paper y restauración validada desde Configuración.
- Historial persistente de experimentos para comparar estrategias sin perder sus supuestos.
- Sandbox con preflight y armado temporal de 15 minutos antes de enviar órdenes.

## Ejecutar

```powershell
npm install
npm start
```

## Generar nuevos ejecutables

Después de modificar el código, usa la ruta portable recomendada:

```powershell
.\generar-release.bat
```

También puedes hacer doble clic en `generar-release.bat` o ejecutar `npm run release:portable`. Se crea un portable con el runtime local de Electron en una carpeta nueva `release/LLM-Trader-<fecha>/`.

Cada compilación conserva las versiones anteriores y genera `build-info.json` con fecha y hashes SHA-256 del código. Cierra la versión anterior antes de abrir una nueva sobre la misma cuenta. Para generar además un instalador de Windows:

```powershell
npm run release
```

`release/` está excluido de Git. El comando no se ejecuta automáticamente: hay que lanzarlo cada vez que quieras empaquetar una versión nueva.

En Configuración se define endpoint, API key y modelo. Las opciones del selector y sus tarifas son valores configurables; selecciona un identificador que tu proveedor realmente ofrezca y confirma su coste. El modelo también puede cambiarse en el modal previo a iniciar Auto-Paper.

## Estructura

```text
src/main/       Proceso principal, IPC, almacenamiento y conectores
src/renderer/   Interfaz segura sin acceso directo a Node.js
```

## Arquitectura para el modo normal

El producto usa dos brokers detrás del mismo límite: `PaperBroker` (simula fills, comisiones, slippage, latencia y liquidez) y `LiveBroker` (lectura y sandbox/testnet mediante Binance). El LLM no recibe claves ni llama al broker directamente: devuelve una intención estructurada y el motor de riesgo valida tamaño, saldo, drawdown, símbolo y permisos antes de cualquier orden.

La sesión real requiere credenciales separadas, permisos mínimos de API, IP restringida, limits, reconciliación, armamento temporal y confirmación explícita por orden. Solo incluye spot manual; el LLM nunca puede colocar órdenes reales. Consulta [la guía del workspace real](docs/LIVE_TRADING_GUIDE.md). La integración necesita una comprobación propia en la cuenta del operador.

## Próximas fases

1. Adaptador de datos de mercado configurable.
2. Backtesting reproducible con SMA/EMA/RSI, comparación cash y buy-and-hold, y separación train/validation/test.
3. Motor de riesgo con límites por cuenta y por operación.
4. Evaluación manual en Spot Testnet/Demo antes de conectar mainnet.
5. No se habilita ejecución real automática.
