# Cuenta Binance spot real y sandbox

El workspace **Real** usa un adaptador separado del paper. Al inicio no hay cuenta activa y ninguna sesión está armada. El envío solo es manual; análisis, consenso y Auto-Paper operan únicamente el ledger virtual.

## Primera cuenta: sandbox/demo

1. Crea una API key de **Spot Testnet** o **Spot Demo**. Para account, order placement, order query y cancellation habilita solo lectura de cuenta y spot trading. Desactiva retiros. Mantén la IP restringida cuando el proveedor admita una IP fija.
2. En Cuenta real guarda el entorno, un nombre local y la API key/secret. El secreto se cifra en el dispositivo y solo el proceso principal lo descifra.
3. Pulsa **Sincronizar cuenta**. Resuelve mensajes del checklist antes de armar. Se consultan balances, permisos, open orders, órdenes con respuesta pendiente y fills.
4. Ajusta el universo y topes de compra, exposición, spread, pérdida diaria y drawdown. Activa ambas confirmaciones y teclea la frase que incluye la cuenta seleccionada. La sesión dura 15 minutos.
5. Prepara una orden LIMIT pequeña. Revisa símbolo, saldo, filtro de lote/tick/notional, bid/ask y topes. Teclea la frase de confirmación antes de enviarla.
6. Consulta los fills verificados y el estado reconciliado. Cancela desde la tabla. **Kill switch** desarma y cancela órdenes abiertas creadas por la aplicación; no liquida posiciones.

## Paso a mainnet

La clave mainnet debe tener permisos de lectura y Spot trading, retiros desactivados e IP restringida. Binance puede requerir verificación adicional. El preflight rechaza la activación cuando falta cualquier propiedad, cuando hay órdenes abiertas de otra herramienta o cuando existe un saldo sin precio verificable en la moneda elegida.

Mainnet soporta MARKET y LIMIT spot dentro de los límites confirmados. Cada preflight y sesión requiere sincronizar balances, órdenes, fills y permisos. Cada orden usa nonce propio, revisión de 30 segundos, límites al precio actual, clave idempotente y segunda consulta al exchange. Si la respuesta de envío o cancelación es ambigua, el estado queda `unknown`; se desarma la sesión y no se repite la orden. Resuelve esa orden en Binance y reconcilia antes de armar otra.

Los límites por defecto son 25 USDT por orden, 100 USDT comprados al día, 35% por activo, 75% de exposición total, 3% de pérdida diaria, 10% de drawdown, 50 bps de spread y cinco órdenes abiertas. El límite por orden puede reducirse o aumentarse hasta 10 000 unidades de la moneda seleccionada; ajusta cualquier valor mayor con especial cuidado. Si los filtros de Binance son más estrictos, su validación final prevalece.

## Alcance y operación

- Spot sin margen, deuda, futuros ni retiros.
- No hay órdenes live automáticas del LLM.
- El stream permanente no es condición para enviar, cancelar ni recuperar órdenes: la pantalla concilia mediante REST cada 15 segundos. El fill que sucede entre consultas aparece en la siguiente reconciliación.
- Cerrar la app desarma la sesión. Al reiniciar debe volver a sincronizar y armar explícitamente.
- El journal conserva órdenes/fills y hash encadenado por cuenta y entorno; balances actuales se leen del exchange, sin inventar coste base de activos que compraste antes de conectar la app.
- Un archivo de estado ilegible, cadena hash inválida o fill incompleto bloquea la cuenta y requiere recuperación manual.
- Ejecuta primero testnet/demo. La integración depende de que la cuenta, el mercado y la jurisdicción permitan su uso; conectar el endpoint no prueba por sí solo que tu propia cuenta pueda operar.

Referencias: [documentación Spot REST de Binance](https://developers.binance.com/en/docs/products/spot/rest-api), [filtros del instrumento](https://github.com/binance/binance-spot-api-docs/blob/master/filters.md), [Spot Testnet](https://github.com/binance/binance-spot-api-docs/blob/master/testnet/general-info.md) y [Spot Demo](https://github.com/binance/binance-spot-api-docs/blob/master/demo-mode/general-info.md).
