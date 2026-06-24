const https = require('https');
const N8N_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIyYWI0NWU4OC00OGU1LTRhZTYtYTM5My1kMTczZTdlZTg1ZmEiLCJpc3MiOiJuOG4iLCJhdWQiOiJwdWJsaWMtYXBpIiwianRpIjoiN2YyODc5MGQtOTFmOC00MjVlLTliZmMtYjBhZTMyMTM2NWIwIiwiaWF0IjoxNzgyMTU3Njc1fQ.qrundBFA-MhpZQAkFlmsla5wJurBLunhhMy6s3SMp6E';

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function post(url, body, headers={}) {
  return new Promise((res,rej)=>{
    const u=new URL(url), data=JSON.stringify(body);
    const r=https.request({hostname:u.hostname,port:443,path:u.pathname,method:'POST',
      headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data),...headers}
    },resp=>{let b='';resp.on('data',d=>b+=d);resp.on('end',()=>{try{res({s:resp.statusCode,b:JSON.parse(b)});}catch{res({s:resp.statusCode,b});}});});
    r.on('error',rej);r.write(data);r.end();
  });
}

function get(host, path, headers={}) {
  return new Promise((res,rej)=>{
    const r=https.request({hostname:host,port:443,path,method:'GET',headers},
      resp=>{let b='';resp.on('data',d=>b+=d);resp.on('end',()=>{try{res({s:resp.statusCode,b:JSON.parse(b)});}catch{res({s:resp.statusCode,b});}});});
    r.on('error',rej);r.end();
  });
}

(async()=>{
  const before=Date.now();
  console.log('Sending "help"...');
  await post('https://whatsapp-hrbot.vercel.app/api/webhooks/whatsapp', {
    object:'whatsapp_business_account',
    entry:[{id:'582d7d0b-c5a5-4699-9191-46c4fe1ef788',changes:[{value:{
      messaging_product:'whatsapp',metadata:{display_phone_number:'15550000001',phone_number_id:'test'},
      contacts:[{profile:{name:'Pranay Khadse'},wa_id:'917058444808'}],
      messages:[{from:'917058444808',id:'dbg_'+Date.now(),timestamp:String(Date.now()),type:'text',text:{body:'help'}}]
    },field:'messages'}]}]
  },{'x-hub-signature-256':'sha256=dummy','X-Org-Id':'582d7d0b-c5a5-4699-9191-46c4fe1ef788','Authorization':'Bearer 0yxnvS8z3lpb2AG4Ljjx8TynSI0edL7NKNGJnKKnyhvO3OFK'});

  console.log('Waiting 15s...');
  await sleep(15000);

  const r=await get('n8n-whatsapp-bot-ouy1.onrender.com',
    '/api/v1/executions?workflowId=NZsKomyCVzVMHqxp&limit=3&includeData=true',
    {'X-N8N-API-KEY':N8N_KEY});

  const execs=r.b.data||[];
  const m=execs.find(e=>e.startedAt&&new Date(e.startedAt).getTime()>before);
  if(!m){console.log('No execution found yet');return;}

  console.log('Exec',m.id,'status:',m.status,m.startedAt);
  const rd=m.data&&m.data.resultData;
  if(!rd){console.log('No result data');return;}

  if(rd.error) console.log('TOP ERROR:',rd.error.message);

  // Check all node outputs
  const nodes=['Fetch User','Build Context','AI Agent','Format Reply'];
  nodes.forEach(nodeName=>{
    const items=rd.runData&&rd.runData[nodeName]||[];
    items.forEach(item=>{
      if(item.error) console.log('['+nodeName+'] ERROR:',item.error.message.slice(0,200));
      const out=item.data&&item.data.main&&item.data.main[0]&&item.data.main[0][0]&&item.data.main[0][0].json;
      if(out&&out.output) console.log('['+nodeName+'] output:',out.output.slice(0,200));
    });
  });
})().catch(console.error);
