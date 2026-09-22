const fs = require('fs');
const path = require('path');
const {createHash}=require('crypto');
const { appendAudit, verifyAuditChain } = require('./auditLog');

class LiveStore {
  constructor(directory, scope, io=fs) {
    if(!/^(mainnet|testnet|demo)-[a-f0-9]{20}$/.test(scope))throw new Error('Identidad de cuenta inválida.');
    this.io=io;this.scope=scope;this.file=path.join(directory,'broker-accounts',scope,'state.json');
  }
  read() {
    let state;
    try{state=JSON.parse(this.io.readFileSync(this.file,'utf8'));}
    catch(error){if(error.code==='ENOENT')return {version:1,scope:this.scope,orders:[],commands:[],fills:[],ledger:[],audit:[],lastSyncAt:null,account:null,limits:null,metrics:{},recovery:[],status:'not-connected'};throw new Error('Estado real ilegible. Se bloquea la ejecución; conserva el archivo para recuperarlo.');}
    if(state.version!==1||state.scope!==this.scope||!['orders','commands','fills','ledger','audit','recovery'].every(k=>Array.isArray(state[k]))||!verifyAuditChain(state.audit).valid||!state.audit.length||state.audit.at(-1).payload.stateHash!==this.hash(state))throw new Error('Integridad del estado real inválida; ejecución bloqueada.');
    return state;
  }
  write(state,event) {
    state.audit=appendAudit(state.audit,{...event,stateHash:this.hash(state)});
    try{
      this.io.mkdirSync(path.dirname(this.file),{recursive:true});
      const tmp=this.file+'.tmp';this.io.writeFileSync(tmp,JSON.stringify(state,null,2),'utf8');
      if(this.io.openSync&&this.io.fsyncSync){const fd=this.io.openSync(tmp,'r+');try{this.io.fsyncSync(fd);}finally{this.io.closeSync(fd);}}
      this.io.renameSync(tmp,this.file);
    }catch(error){throw new Error(`No se pudo guardar el estado real; cuenta desarmada y operaciones bloqueadas: ${error.message}`);}
  }
  hash(state){const {audit,...rest}=state;return createHash('sha256').update(JSON.stringify(rest)).digest('hex');}
}
module.exports={LiveStore};
