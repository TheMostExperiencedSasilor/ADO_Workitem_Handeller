const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load() {
  class Element {
    constructor() { this.value=''; this.children=[]; this.listeners={}; this.attributes={}; this.classes=new Set(); this.textContent='';
      this.classList={add:n=>this.classes.add(n),contains:n=>this.classes.has(n),toggle:(n,active)=>{ if(active===undefined) active=!this.classes.has(n); active?this.classes.add(n):this.classes.delete(n); }}; }
    addEventListener(type, fn) { this.listeners[type]=fn; }
    replaceChildren() { this.children=[]; this.textContent=''; }
    appendChild(child) { this.children.push(child); }
    get options() { return this.children; }
    setAttribute(k,v) { this.attributes[k]=v; }
    focus() { this.focused=true; }
    click() { return this.listeners.click?.(); }
  }
  const nodes=new Map();
  const $=id=>{ if(!nodes.has(id)) nodes.set(id,new Element()); return nodes.get(id); };
  $('chatbox').classes.add('hidden');
  const calls=[];
  const context=vm.createContext({document:{getElementById:$,createElement:()=>new Element(),querySelector:s=>$(s.slice(1))},
    api:async(path,options)=>{calls.push({path,body:options?.body?JSON.parse(options.body):null});return context.respond(path,options);},
    respond:async()=>({connected:false,models:[]})});
  vm.runInContext(fs.readFileSync('frontend/assistant.js','utf8'),context);
  const flush=()=>new Promise(resolve=>setImmediate(resolve));
  const models=[{id:'other',name:'Other'},{id:'gpt-6-luna',name:'Luna'}];
  async function connect() {
    context.respond=async()=>({connected:true,models});
    $('copilotToken').value='secret'; $('copilotToken').listeners.input();
    await $('connectAiButton').click();
  }
  const submit=()=>$('chatForm').listeners.submit({preventDefault(){}});
  return {$,calls,context,flush,connect,submit};
}

test('connect validates empty token, shows progress, clears secret, selects account model, disconnects',async()=>{
 const {$,context,calls,flush}=load(); await flush();
 assert.equal($('connectAiButton').disabled,true);
 assert.equal($('chatInput').disabled,true);
 let resolve;
 context.respond=()=>new Promise(r=>{resolve=r;});
 $('copilotToken').value='secret'; $('copilotToken').listeners.input();
 const pending=$('connectAiButton').click();
 assert.equal($('aiConnectProgress').hidden,false);
 assert.equal($('chatInput').disabled,true);
 resolve({connected:true,models:[{id:'a',name:'A'},{id:'gpt-6-luna',name:'Luna'}]}); await pending;
 assert.equal($('copilotToken').value,'');
 assert.equal($('chatModel').value,'gpt-6-luna');
 assert.equal($('aiSetupStatus').textContent,'Copilot connected');
 assert.equal($('aiConnectProgress').hidden,true);
 assert.equal($('connectAiButton').disabled,true);
 assert.equal(calls[1].body.token,'secret');
 context.respond=async()=>({connected:false,models:[]});
 await $('disconnectAiButton').click();
 assert.equal($('chatInput').disabled,true);
 assert.equal($('chatModel').options.length,0);
});

test('follow-ups carry history/context; pending send is serialized; replies stay plain text; new chat resets',async()=>{
 const {$,context,calls,flush,connect,submit}=load(); await flush(); await connect();
 $('chatContextIds').value='123, 456'; $('chatInput').value='Question';
 let resolve;context.respond=()=>new Promise(r=>{resolve=r;});
 const pending=submit(); await submit();
 assert.equal(calls.filter(c=>c.path==='/api/chat').length,1);
 assert.equal($('chatSend').disabled,true);
 resolve({answer:'<script>unsafe()</script>\nLine two',contextIds:[123,456]}); await pending;
 assert.equal($('chatMessages').children[1].textContent,'<script>unsafe()</script>\nLine two');
 const first=calls.at(-1).body;
 assert.deepEqual(first.ids,['123','456']);assert.deepEqual(first.history,[]);
 context.respond=async()=>({answer:'Second answer',contextIds:[]});
 $('chatInput').value='Follow up'; await submit();
 assert.equal(calls.at(-1).body.history.length,2);
 assert.equal(calls.at(-1).body.history[1].role,'assistant');
 $('chatNew').click();
 assert.equal($('chatMessages').children.length,0);assert.equal($('chatContextIds').value,'');
 $('chatInput').value='Fresh question'; await submit();
 assert.deepEqual(calls.at(-1).body.history,[]);
});

test('bad IDs stay local; failed send restores input; failed connect leaves chat disabled',async()=>{
 const {$,context,calls,flush,connect,submit}=load();await flush();await connect();
 $('chatContextIds').value='abc';$('chatInput').value='Question';
 await submit();assert.equal(calls.filter(c=>c.path==='/api/chat').length,0);
 assert.match($('chatStatus').textContent,/positive work-item IDs/);
 $('chatContextIds').value='';context.respond=async()=>{throw new Error('Service unavailable');};
 await submit();
 assert.equal($('chatInput').value,'Question');
 assert.equal($('chatMessages').children[1].textContent,'Service unavailable');
 assert.equal($('chatInput').disabled,false);
 $('copilotToken').value='bad';$('copilotToken').listeners.input();await $('connectAiButton').click();
 assert.equal($('chatInput').disabled,true);
 assert.equal($('aiSetupError').textContent,'Service unavailable');
 assert.equal($('aiConnectProgress').hidden,true);
});

test('toggle, close, Escape, and setup navigation expose accessible state',async()=>{
 const {$,flush}=load();await flush();
 $('chatToggle').click();assert.equal($('chatToggle').attributes['aria-expanded'],'true');
 $('chatbox').listeners.keydown({key:'Escape'});
 assert.equal($('chatToggle').attributes['aria-expanded'],'false');
 let setupClicked=false;$('main-tab-0').listeners.click=()=>{setupClicked=true;};
 $('chatSetup').click();assert.equal(setupClicked,true);assert.equal($('copilotToken').focused,true);
});
