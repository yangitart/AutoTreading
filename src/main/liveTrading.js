const { randomUUID,createHash }=require('crypto');
const { normalizeBinanceOrder }=require('./binanceClient');
const { normalizeBalances }=require('./brokerContract');
const { SerializedMutationQueue }=require('./mutationQueue');
const { DEFAULT_LIVE_LIMITS,validateLimits,normalizeRequest,validateLiveOrder }=require('./liveRisk');
const { freshQuote }=require('./quoteQuality');
const OPEN=new Set(['accepted','partial','cancelling','unknown']);
const FINAL=new Set(['filled','cancelled','expired','rejected']);
const key=o=>`${o.symbol}:${o.providerOrderId??o.clientOrderId}`;

class LiveTradingService {
  constructor({scope,environment,label,client,store,now=Date.now,onUpdate=()=>{}}){
    Object.assign(this,{scope,environment,label,client,store,now,onUpdate});this.queue=new SerializedMutationQueue();this.state=store.read();this.session=null;this.epoch=0;this.previews=new Map();this.closed=false;this.reconciling=null;
    this.state.status='not-connected';this.state.lastSyncAt=null;
  }
  persist(event){try{this.store.write(this.state,event);this.publish();}catch(error){this.epoch++;this.session=null;this.previews.clear();this.state.status='error';this.state.error=error.message;this.publish();throw error;}}
  snapshot(){
    const s=this.state,armed=Boolean(this.session&&this.now()<this.session.expiresAt);
    return {scope:this.scope,environment:this.environment,label:this.label,status:s.status,error:s.error||null,account:s.account,orders:s.orders,openOrders:s.orders.filter(o=>OPEN.has(o.status)),recovery:s.recovery,limits:s.limits||DEFAULT_LIVE_LIMITS,metrics:s.metrics,unpricedAssets:s.unpricedAssets||[],fills:s.fills.slice(-100).reverse(),ledgerEntries:s.ledger.length,auditEntries:s.audit.length,lastSyncAt:s.lastSyncAt,transport:'REST',armed,armedUntil:armed?new Date(this.session.expiresAt).toISOString():null,acknowledgement:this.armPhrase(),pendingCommands:s.commands.filter(c=>['submitting','unknown','cancelling'].includes(c.status)).length};
  }
  publish(){this.onUpdate(this.snapshot());}
  armPhrase(){return `${this.environment==='mainnet'?'ACTIVAR REAL':'ACTIVAR '+this.environment.toUpperCase()} ${this.scope.slice(-6)}`;}
  orderPhrase(){return this.environment==='mainnet'?'CONFIRMAR REAL':`CONFIRMAR ${this.environment.toUpperCase()}`;}
  disarm(reason='Sesión detenida') {this.epoch++;this.session=null;this.previews.clear();this.state.disarmedReason=reason;this.publish();return this.snapshot();}
  shutdown(){this.closed=true;this.disarm('Cuenta desconectada');}
  isArmed(epoch=this.epoch){return !this.closed&&epoch===this.epoch&&this.session&&this.now()<this.session.expiresAt;}
  requireArmed(epoch){if(!this.isArmed(epoch))throw new Error('Sesión desarmada, caducada o detenida. Actívala de nuevo.');}
  addOrder(raw){
    const incoming=normalizeBinanceOrder(raw);
    if(!incoming.symbol||incoming.providerOrderId===null||!Number.isFinite(incoming.executedQuantity)||incoming.executedQuantity<0||incoming.status==='unknown')throw new Error('Estado de orden del broker inválido o desconocido.');
    const index=this.state.orders.findIndex(o=>key(o)===key(incoming)||o.symbol===incoming.symbol&&o.clientOrderId===incoming.clientOrderId);
    const previous=this.state.orders[index];
    let next=incoming;
    if(previous){
      const older=Number(incoming.eventTime||0)<Number(previous.eventTime||0),regression=FINAL.has(previous.status)&&!FINAL.has(incoming.status);
      next=(older||regression)?{...previous,executedQuantity:Math.max(previous.executedQuantity,incoming.executedQuantity),quoteQuantity:Math.max(previous.quoteQuantity,incoming.quoteQuantity)}:{...previous,...incoming,executedQuantity:Math.max(previous.executedQuantity,incoming.executedQuantity)};
      if(next.executedQuantity>=next.quantity&&next.quantity>0)next.status='filled';
      this.state.orders[index]=next;
    }else this.state.orders.push(next);
    for(const c of this.state.commands)if(c.order.symbol===next.symbol&&c.clientOrderId===next.clientOrderId)c.status=next.status;
    return next;
  }
  async syncFills(order){
    if(!order.executedQuantity)return;
    const known=this.state.fills.filter(f=>f.symbol===order.symbol&&String(f.orderId)===String(order.providerOrderId));
    if(known.reduce((n,f)=>n+f.quantity,0)>=order.executedQuantity-1e-10)return;
    const instrument=await this.client.getInstrument(order.symbol),trades=await this.client.getTrades({symbol:order.symbol,orderId:order.providerOrderId});
    if(!Array.isArray(trades))throw new Error('El broker no devolvió fills verificables.');
    for(const t of trades){
      if(String(t.orderId)!==String(order.providerOrderId))continue;
      const fillId=`${order.symbol}:${t.id}`;
      if(this.state.fills.some(f=>f.fillId===fillId))continue;
      const quantity=Number(t.qty),quoteQuantity=Number(t.quoteQty),commission=Number(t.commission),price=Number(t.price);
      if(t.id==null||![quantity,quoteQuantity,price].every(n=>Number.isFinite(n)&&n>0)||!Number.isFinite(commission)||commission<0||!t.commissionAsset)throw new Error('Fill inválido: falta cantidad, precio o comisión.');
      const fill={fillId,symbol:order.symbol,orderId:order.providerOrderId,side:order.side,quantity,quoteQuantity,price,commission,commissionAsset:t.commissionAsset,time:t.time};
      const entries=[],post=(asset,account,side,amount)=>entries.push({asset,account,side,amount});
      const buying=order.side==='BUY';
      post(instrument.baseAsset,'balance',buying?'debit':'credit',quantity);post(instrument.baseAsset,'trade-clearing',buying?'credit':'debit',quantity);
      post(instrument.quoteAsset,'balance',buying?'credit':'debit',quoteQuantity);post(instrument.quoteAsset,'trade-clearing',buying?'debit':'credit',quoteQuantity);
      if(commission){post(t.commissionAsset,'fees','debit',commission);post(t.commissionAsset,'balance','credit',commission);}
      this.state.fills.push(fill);this.state.ledger.push({fillId,entries});
    }
    const total=this.state.fills.filter(f=>f.symbol===order.symbol&&String(f.orderId)===String(order.providerOrderId)).reduce((n,f)=>n+f.quantity,0);
    if(Math.abs(total-order.executedQuantity)>1e-8)throw new Error('Fills incompletos: reconcilia antes de abrir nuevas órdenes.');
  }
  async valueAccount(){
    const limits=this.state.limits||DEFAULT_LIVE_LIMITS,values={},unpriced=[];
    for(const b of this.state.account.balances){
      if(b.asset===limits.quoteAsset){values[b.asset]=b.total;continue;}
      try{const q=await this.client.getQuote(b.asset+limits.quoteAsset);if(!freshQuote(q,10000,this.now()))throw new Error('stale');values[b.asset]=b.total*q.bid;}
      catch{unpriced.push(b.asset);}
    }
    this.state.valuations=values;this.state.unpricedAssets=unpriced;
    const equity=Object.values(values).reduce((n,v)=>n+v,0),exposure=equity-Number(values[limits.quoteAsset]||0),day=new Date(this.now()).toISOString().slice(0,10),prior=this.state.metrics||{};
    const peak=unpriced.length?prior.peak||equity:Math.max(prior.peak||equity,equity),dayStart=prior.day===day?prior.dayStart:equity;
    this.state.metrics={equity,exposure,peak,day,dayStart,drawdownPct:peak?Math.max(0,(peak-equity)/peak*100):0,dailyLossPct:dayStart?Math.max(0,(dayStart-equity)/dayStart*100):0,quoteAsset:limits.quoteAsset};
  }
  reconcile(){
    if(this.reconciling)return this.reconciling;
    this.reconciling=this.queue.enqueue('reconcile',()=>this._reconcile()).finally(()=>{this.reconciling=null;});return this.reconciling;
  }
  async _reconcile(){
    if(this.closed)throw new Error('Cuenta desconectada.');
    this.state.recovery=[];
    try{
      const remote=await this.client.getOpenOrders();if(!Array.isArray(remote))throw new Error('Respuesta de órdenes abiertas inválida.');
      const active=new Set();for(const raw of remote){const o=this.addOrder(raw);active.add(key(o));}
      this.state.exchangeOpenOrders=remote.map(raw=>{const o=normalizeBinanceOrder(raw);return {providerOrderId:o.providerOrderId,clientOrderId:o.clientOrderId,symbol:o.symbol,side:o.side,type:o.type,status:o.status,quantity:o.quantity,executedQuantity:o.executedQuantity,price:o.price};});
      const candidates=new Map();
      for(const o of this.state.orders)if(OPEN.has(o.status)&&!active.has(key(o)))candidates.set(`${o.symbol}:${o.clientOrderId}`,{symbol:o.symbol,orderId:o.providerOrderId,clientOrderId:o.clientOrderId});
      for(const c of this.state.commands)if(['submitting','unknown','cancelling'].includes(c.status))candidates.set(`${c.order.symbol}:${c.clientOrderId}`,{symbol:c.order.symbol,clientOrderId:c.clientOrderId});
      for(const q of candidates.values()){
        try{this.addOrder(await this.client.getOrder(q));}
        catch(error){this.state.recovery.push({symbol:q.symbol,clientOrderId:q.clientOrderId,error:error.message});}
      }
      for(const o of this.state.orders){try{await this.syncFills(o);}catch(error){this.state.recovery.push({symbol:o.symbol,clientOrderId:o.clientOrderId,error:error.message});}}
      const account=await this.client.getAccount();
      if(!Array.isArray(account.balances)||account.balances.some(b=>![Number(b.free),Number(b.locked)].every(n=>Number.isFinite(n)&&n>=0)))throw new Error('Balances del broker inválidos.');
      this.state.account={environment:this.environment,accountType:account.accountType,canTrade:account.canTrade===true,balances:normalizeBalances(account)};
      if(this.environment==='mainnet')this.state.permissions=await this.client.getPermissions();
      await this.valueAccount();
      this.state.status=this.state.recovery.length?'attention':'connected';this.state.error=null;this.state.lastSyncAt=new Date(this.now()).toISOString();
      this.persist({type:'reconciliation',open:remote.length,recovery:this.state.recovery.length});
    }catch(error){this.state.status='error';this.state.error=error.message;this.disarm('Conexión perdida');this.persist({type:'reconciliation-error',error:error.message});throw error;}
    if(this.state.recovery.length)this.disarm('Hay estados sin resolver');
    return this.snapshot();
  }
  preflight(){return this.queue.enqueue('preflight',async()=>{await this._reconcile();return this.checks();});}
  checks(){
    const s=this.state,p=s.permissions||{},checks=[
      {label:'Cuenta sincronizada',ok:s.status==='connected'&&this.now()-Date.parse(s.lastSyncAt)<15000,detail:s.lastSyncAt||'Sin conexión'},
      {label:'Spot habilitado',ok:s.account?.canTrade===true&&s.account?.accountType==='SPOT',detail:s.account?.accountType||'Sin cuenta'},
      {label:'Órdenes y fills reconciliados',ok:!s.recovery.length&&!s.commands.some(c=>['unknown','submitting','cancelling'].includes(c.status)),detail:s.recovery.length?`${s.recovery.length} incidencias por resolver`:'Sin respuestas inciertas'},
      {label:'Valoración disponible',ok:!s.unpricedAssets?.length,detail:s.unpricedAssets?.length?s.unpricedAssets.join(', '):'Saldos valorados en la moneda de límites'}
    ];
    if(this.environment==='mainnet')checks.push({label:'Permisos mínimos de la clave',ok:p.enableReading===true&&p.enableSpotAndMarginTrading===true&&p.enableWithdrawals===false,detail:'Se exige lectura y spot, sin permiso de retiros.'},{label:'Restricción de IP',ok:p.ipRestrict===true,detail:'Configura la IP autorizada de tu equipo en Binance.'});
    const unowned=s.orders.filter(o=>OPEN.has(o.status)&&!s.commands.some(c=>c.clientOrderId===o.clientOrderId));
    checks.push({label:'Órdenes externas resueltas',ok:unowned.length===0,detail:unowned.length?`${unowned.length} orden(es) abierta(s) ajena(s) a la app; resuélvelas directamente en Binance.`:'No hay órdenes abiertas creadas fuera de la app.'});
    return {ready:checks.every(c=>c.ok),checks,scope:this.scope,environment:this.environment,acknowledgement:this.armPhrase(),snapshot:this.snapshot()};
  }
  arm({limits,acknowledgement,confirmRisk,confirmLocalMonitoring}={}){
    const epoch=this.epoch;
    return this.queue.enqueue('arm',async()=>{
      if(acknowledgement!==this.armPhrase()||confirmRisk!==true||confirmLocalMonitoring!==true)throw new Error('Confirma la cuenta, los límites y la vigilancia local antes de activar.');
      const next=validateLimits(limits);
      this.state.limits=next;await this._reconcile();
      if(epoch!==this.epoch||this.closed)throw new Error('La activación fue interrumpida.');
      const preflight=this.checks();if(!preflight.ready)throw new Error(preflight.checks.filter(c=>!c.ok).map(c=>c.label).join('; '));
      this.session={expiresAt:this.now()+15*60000,limits:structuredClone(next)};
      this.persist({type:'session-armed',environment:this.environment,expiresAt:this.session.expiresAt,limits:next});return this.snapshot();
    });
  }
  preview(request){
    const epoch=this.epoch;return this.queue.enqueue('preview',async()=>{
      this.requireArmed(epoch);const order=normalizeRequest(request);await this._reconcile();this.requireArmed(epoch);
      if(!this.checks().ready)throw new Error('La cuenta ya no supera el preflight.');
      const instrument=await this.client.getInstrument(order.symbol),quote=await this.client.getQuote(order.symbol);this.requireArmed(epoch);
      const risk=validateLiveOrder({order,instrument,quote,state:this.state,limits:this.session.limits,now:this.now()});
      const id=randomUUID(),requestId=randomUUID(),preview={id,requestId,scope:this.scope,environment:this.environment,order,risk,epoch,expiresAt:this.now()+30000,acknowledgement:this.orderPhrase()};
      this.previews.clear();this.previews.set(id,preview);return structuredClone(preview);
    });
  }
  submit({previewId,requestId,acknowledgement}={}){
    const epoch=this.epoch;return this.queue.enqueue('submit',async()=>{
      const existing=this.state.commands.find(c=>c.requestId===requestId);
      if(existing)return {command:existing,snapshot:this.snapshot(),duplicate:true};
      this.requireArmed(epoch);const preview=this.previews.get(previewId);
      if(!preview||preview.requestId!==requestId||preview.epoch!==epoch||this.now()>preview.expiresAt||acknowledgement!==this.orderPhrase())throw new Error('Revisión de orden ausente, caducada o sin confirmación.');
      await this._reconcile();this.requireArmed(epoch);if(!this.checks().ready)throw new Error('Preflight rechazado antes del envío.');
      const instrument=await this.client.getInstrument(preview.order.symbol),quote=await this.client.getQuote(preview.order.symbol);this.requireArmed(epoch);
      if(this.now()>preview.expiresAt)throw new Error('La revisión caducó durante las comprobaciones.');
      if(Math.abs((preview.order.side==='BUY'?quote.ask:quote.bid)/preview.risk.referencePrice-1)*100>this.session.limits.maxPriceDeviationPct)throw new Error('El precio cambió demasiado. Revisa otra cotización.');
      const risk=validateLiveOrder({order:preview.order,instrument,quote,state:this.state,limits:this.session.limits,now:this.now()});
      const clientOrderId='lt-'+createHash('sha256').update(this.scope+':'+requestId).digest('hex').slice(0,28);
      const command={requestId,clientOrderId,order:preview.order,notional:risk.notional,status:'submitting',createdAt:new Date(this.now()).toISOString()};
      this.state.commands.push(command);this.persist({type:'order-intent',requestId,clientOrderId,order:preview.order});this.previews.delete(previewId);
      try{const response=await this.client.placeOrder({...preview.order,clientOrderId});this.addOrder(response);this.persist({type:'order-response',clientOrderId,response});}
      catch(error){command.status=error.ambiguous===false?'rejected':'unknown';command.error=error.message;this.disarm('Envío rechazado o sin confirmar');this.persist({type:'order-error',clientOrderId,status:command.status,error:error.message});}
      try{await this._reconcile();}catch{/* command remains durable even when reconciliation is unavailable */}
      return {command,snapshot:this.snapshot(),duplicate:false};
    });
  }
  async cancelKnown(order){
    const command=this.state.commands.find(c=>c.clientOrderId===order.clientOrderId&&c.order.symbol===order.symbol);
    if(!command)throw new Error('Solo se cancelan órdenes creadas por esta aplicación y cuenta.');
    if(FINAL.has(order.status))return order;
    command.status='cancelling';this.persist({type:'cancel-intent',clientOrderId:command.clientOrderId});
    try{const response=await this.client.cancelOrder({symbol:order.symbol,orderId:order.providerOrderId,clientOrderId:order.clientOrderId});const result=this.addOrder(response);this.persist({type:'cancel-response',clientOrderId:command.clientOrderId,status:result.status});return result;}
    catch(error){command.status='unknown';command.error=error.message;this.persist({type:'cancel-uncertain',clientOrderId:command.clientOrderId,error:error.message});try{return this.addOrder(await this.client.getOrder({symbol:order.symbol,orderId:order.providerOrderId}));}catch{return null;}}
  }
  cancel({symbol,clientOrderId,scope}={}){
    return this.queue.enqueue('cancel',async()=>{if(scope!==this.scope)throw new Error('La cuenta seleccionada cambió.');const order=this.state.orders.find(o=>o.symbol===symbol&&o.clientOrderId===clientOrderId);if(!order)throw new Error('Orden desconocida.');await this.cancelKnown(order);await this._reconcile();return this.snapshot();});
  }
  kill(){
    this.disarm('Kill switch activado');
    return this.queue.enqueue('kill',async()=>{
      // Query first: late submissions and orders recovered after restart must
      // be included, even when the UI did not receive their acknowledgement.
      try{await this._reconcile();}catch{/* attempt known cancellations even with partial connectivity */}
      const results=[];
      for(const order of this.state.orders.filter(o=>OPEN.has(o.status)&&this.state.commands.some(c=>c.clientOrderId===o.clientOrderId&&c.order.symbol===o.symbol))){const result=await this.cancelKnown(order);results.push({symbol:order.symbol,clientOrderId:order.clientOrderId,status:result?.status||'unknown'});}
      try{await this._reconcile();}catch{}
      this.persist({type:'kill-switch',results});return {snapshot:this.snapshot(),results,complete:!this.state.recovery.length&&!this.state.commands.some(c=>['unknown','submitting','cancelling','accepted','partial'].includes(c.status))};
    });
  }
  canSwitch(){return !this.isArmed()&&!this.state.orders.some(o=>OPEN.has(o.status))&&!this.state.commands.some(c=>['submitting','unknown','cancelling','accepted','partial'].includes(c.status));}
}
module.exports={LiveTradingService,OPEN,FINAL};
