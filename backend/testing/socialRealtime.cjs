// Test-only Supabase Realtime wire boundary. Production triggers and RLS run in
// PostgreSQL; ws models transport, subscription acknowledgements and outages.
const { WebSocketServer } = require('ws');
const fs = require('node:fs'), path = require('node:path');
exports.install = async db => {
    await db.exec(`create schema realtime;
        create table realtime.messages(id bigint generated always as identity primary key, topic text, extension text, payload jsonb, event text, private boolean);
        alter table realtime.messages enable row level security;
        grant usage on schema realtime to authenticated,anon;
        grant select,insert on realtime.messages to authenticated,anon;
        grant usage on sequence realtime.messages_id_seq to authenticated,anon;
        create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
        create function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language sql security definer as $$
          insert into realtime.messages(topic,extension,payload,event,private) values(topic,'broadcast',payload,event,private); $$;
        create table watchly_test_cdc(id bigint generated always as identity, table_name text, action text, record jsonb);
        create function watchly_test_capture() returns trigger language plpgsql security definer as $$ begin
          insert into public.watchly_test_cdc(table_name,action,record) values(TG_TABLE_NAME,TG_OP,case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end);
          return null; end $$;`);
    for (const table of ['friend_requests','friendships','blocks','room_invites']) await db.exec(`create trigger test_cdc after insert or update or delete on public.${table} for each row execute function watchly_test_capture();`);
    const migration = fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/202610040001_watchly_social_realtime.sql'),'utf8');
    await db.exec(migration);
    return migration;
};
exports.transport = ({server,db,tokens,asUser}) => {
    const wsServer = new WebSocketServer({server,path:'/realtime/v1/websocket'}), peers = new Set(), delivered = [];
    let cdcCursor = 0, messageCursor = 0, bindingId = 1, flushing = Promise.resolve();
    const send = (peer,topic,event,payload,ref=null,join_ref=null) => { if(peer.ws.readyState===1) peer.ws.send(JSON.stringify(peer.array ? [join_ref,ref,topic,event,payload] : {topic,event,payload,ref,join_ref})); };
    wsServer.on('connection',ws => {
        const peer = {ws,channels:new Map()}; peers.add(peer); ws.on('close',()=>peers.delete(peer));
        ws.on('message',async raw => {
            const parsed=JSON.parse(String(raw)); peer.array=Array.isArray(parsed);
            const message=peer.array?{join_ref:parsed[0],ref:parsed[1],topic:parsed[2],event:parsed[3],payload:parsed[4]}:parsed;
            const {topic,event,payload,ref,join_ref}=message;
            const reply=(status,response={})=>send(peer,topic,'phx_reply',{status,response},ref,join_ref);
            if(event==='heartbeat')return reply('ok');
            if(event==='phx_leave'){peer.channels.delete(topic);return reply('ok');}
            if(event==='access_token'){const channel=peer.channels.get(topic);if(channel)channel.id=tokens.get(payload.access_token);return;}
            if(event!=='phx_join')return;
            const id=tokens.get(payload.access_token), config=payload.config||{};
            if(!id)return reply('error',{reason:'Authentication required'});
            if(config.private){
                // Probe the production topic policy with a transaction-local row,
                // matching the service's rolled-back authorization query.
                const authorized=await db.transaction(async tx=>{
                    const name=topic.replace(/^realtime:/,'');
                    await tx.query("insert into realtime.messages(topic,extension,payload,event,private) values($1,'broadcast','{}','probe',true)",[name]);
                    await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('realtime.topic',$2,true)",[id,name]);
                    const rows=(await tx.query('select id from realtime.messages where topic=$1',[name])).rows;
                    await tx.exec('reset role');await tx.query("delete from realtime.messages where event='probe'");
                    return rows.length>0;
                });
                if(!authorized)return reply('error',{reason:'Unauthorized private topic'});
            }
            const bindings=(config.postgres_changes||[]).map(filter=>({...filter,id:bindingId++}));
            peer.channels.set(topic,{id,private:config.private,bindings,join_ref});
            reply('ok',{postgres_changes:bindings});
        });
    });
    const flush = () => {
        flushing=flushing.then(async()=>{
            const records=(await db.query('select * from watchly_test_cdc where id>$1 order by id',[cdcCursor])).rows;
            const messages=(await db.query("select * from realtime.messages where id>$1 and event<>'probe' order by id",[messageCursor])).rows;
            for(const row of records){
                cdcCursor=Math.max(cdcCursor,Number(row.id));
                if(row.action==='DELETE')continue; // private invalidation handles all deletes
                for(const peer of peers)for(const[topic,channel]of peer.channels){
                    if(channel.private||!channel.id)continue;
                    const bindings=channel.bindings.filter(binding=>binding.table===row.table_name&&binding.event===row.action
                        &&row.record[binding.filter.split('=eq.')[0]]===binding.filter.split('=eq.')[1]);
                    if(!bindings.length)continue;
                    const predicate=row.table_name==='friendships'?'user_low=$1 and user_high=$2':row.table_name==='blocks'?'blocker_id=$1 and blocked_id=$2':'id=$1';
                    const args=row.table_name==='friendships'?[row.record.user_low,row.record.user_high]:row.table_name==='blocks'?[row.record.blocker_id,row.record.blocked_id]:[row.record.id];
                    if(!(await asUser(channel.id,`select * from public.${row.table_name} where ${predicate}`,args)).length)continue;
                    const data={schema:'public',table:row.table_name,type:row.action,commit_timestamp:new Date().toISOString(),columns:[],record:row.record,old_record:{},errors:null};
                    send(peer,topic,'postgres_changes',{ids:bindings.map(binding=>binding.id),data},null,channel.join_ref);
                    delivered.push({id:channel.id,kind:'postgres_changes',table:row.table_name});
                }
            }
            for(const row of messages){
                messageCursor=Math.max(messageCursor,Number(row.id));
                for(const peer of peers)for(const[topic,channel]of peer.channels){
                    if(channel.private&&channel.id&&topic===`realtime:${row.topic}`&&row.topic===`watchly-social:${channel.id}`){
                        send(peer,topic,'broadcast',{type:'broadcast',event:row.event,payload:row.payload},null,channel.join_ref);
                        delivered.push({id:channel.id,kind:'broadcast',payload:row.payload});
                    }
                }
            }
        });
        return flushing;
    };
    return {flush,delivered,channels:()=>[...peers].flatMap(peer=>[...peer.channels].map(([topic,channel])=>({topic,id:channel.id,private:channel.private}))),
        disconnect:id=>{for(const peer of peers)if([...peer.channels.values()].some(channel=>channel.id===id))peer.ws.terminate();},
        close:async()=>{for(const peer of peers)peer.ws.terminate();await new Promise(resolve=>wsServer.close(resolve));}};
};
