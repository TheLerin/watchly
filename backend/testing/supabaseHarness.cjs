// Test-only Supabase Auth/REST boundary backed by real PostgreSQL/RLS. No live
// project, real emails or Google credentials are used by browser verification.
const http = require('node:http');
const crypto = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const realtimeFixture = require('./socialRealtime.cjs');
const A = '00000000-0000-4000-8000-000000000001', B = '00000000-0000-4000-8000-000000000002', C = '00000000-0000-4000-8000-000000000003';
module.exports = async function createHarness() {
    const db = new PGlite(), tokens = new Map(), codes = new Map(), revokedRefresh = new Set(), requests = [];
    const users = new Map([[A,{id:A,email:'alice@example.test',user_metadata:{full_name:'Alice'}}],[B,{id:B,email:'bob@example.test',user_metadata:{full_name:'Bob'}}],[C,{id:C,email:'carol@example.test',user_metadata:{full_name:'Carol'}}]]);
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
        create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
        grant usage on schema auth to authenticated; insert into auth.users values('${A}'),('${B}'),('${C}');`);
    await db.exec(readFileSync(path.resolve(__dirname,'../../supabase/migrations/202610030001_watchly_accounts.sql'),'utf8'));
    await realtimeFixture.install(db);
    let realtime;
    const rawSql = (id, text, args=[]) => db.transaction(async tx => { await tx.exec('set local role authenticated'); await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]); return (await tx.query(text,args)).rows; });
    const sql = async (id,text,args=[]) => { const rows=await rawSql(id,text,args); await realtime?.flush(); return rows; };
    const privateSql = async (text,args) => { const rows=await db.transaction(async tx => { await tx.exec('set local role service_role'); return (await tx.query(text,args)).rows; }); await realtime?.flush(); return rows; };
    const session = id => {
        const exp=Math.floor(Date.now()/1000)+3600;
        const token=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:id,role:'authenticated',aud:'authenticated',exp,nonce:crypto.randomUUID()})).toString('base64url')}.test-signature`;
        tokens.set(token,id); return {access_token:token,refresh_token:`refresh:${id}`,token_type:'bearer',expires_in:3600,expires_at:exp,user:users.get(id)};
    };
    const procedures={
        get_my_watchly:[],get_social_data:[['sections','text[]']],friend_ids:[],touch_profile:[],search_people:[['query_text','text']],request_friend:[['target_id','uuid']],
        respond_friend_request:[['request_id','uuid'],['accept','boolean']],remove_friend:[['target_id','uuid']],block_person:[['target_id','uuid']],unblock_person:[['target_id','uuid']],
        send_room_invite:[['verified_sender_id','uuid'],['target_id','uuid'],['invite_room_code','text']],respond_room_invite:[['invite_id','uuid'],['accept','boolean']],
    };
    let googleId=A;
    const server=http.createServer(async(req,res)=>{
        res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','*'); res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS');
        res.setHeader('X-Supabase-Api-Version','2024-01-01'); res.setHeader('Access-Control-Expose-Headers','X-Supabase-Api-Version');
        if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
        const url=new URL(req.url,'http://test'); let text=''; for await(const chunk of req) text+=chunk;
        let body={}; try{body=text?JSON.parse(text):{};}catch{}
        const json=(value,status=200)=>{requests.push({path:url.pathname,status,code:value?.code,sections:body.sections});res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
        const id=tokens.get(String(req.headers.authorization||'').replace(/^Bearer /,''));
        try{
            if(url.pathname==='/auth/v1/authorize'){
                const code=crypto.randomUUID(); codes.set(code,{id:googleId,challenge:url.searchParams.get('code_challenge')});
                const callback=new URL(url.searchParams.get('redirect_to'));callback.searchParams.set('code',code);res.writeHead(302,{Location:callback.href});res.end();return;
            }
            if(url.pathname==='/auth/v1/otp')return json({});
            if(url.pathname==='/auth/v1/verify'){
                const person=[...users.values()].find(user=>user.email===body.email);
                if(!person||body.token!=='123456')return json({code:'otp_expired',message:'Expired or invalid OTP'},403);
                return json(session(person.id));
            }
            if(url.pathname==='/auth/v1/token'){
                if(url.searchParams.get('grant_type')==='pkce'){
                    const flow=codes.get(body.auth_code); const challenge=crypto.createHash('sha256').update(body.code_verifier||'').digest('base64url');
                    if(!flow||flow.challenge!==challenge)return json({message:'Invalid code verifier'},400);
                    codes.delete(body.auth_code); return json(session(flow.id));
                }
                const refreshed=String(body.refresh_token||'').replace(/^refresh:/,'');
                if(revokedRefresh.has(refreshed))return json({code:'refresh_token_not_found',message:'Invalid refresh token'},400);
                return users.has(refreshed)?json(session(refreshed)):json({message:'Invalid refresh token'},401);
            }
            if(url.pathname==='/auth/v1/user')return id?json(users.get(id)):json({message:'Invalid JWT'},401);
            if(url.pathname==='/auth/v1/logout'){if(id)for(const[token,owner]of tokens)if(owner===id)tokens.delete(token);res.writeHead(204);res.end();return;}
            const privateInvite=url.pathname==='/rest/v1/rpc/send_room_invite'&&req.headers.apikey==='service-role-test-only'&&req.headers.authorization==='Bearer service-role-test-only';
            if(!id&&!privateInvite)return json({message:'Authentication required'},401);
            if(url.pathname==='/rest/v1/profiles'){
                let rows;
                if(req.method==='POST')rows=await sql(id,`insert into public.profiles(id,username,display_name,avatar_url) values($1,$2,$3,$4)
                    on conflict(id) do update set id=excluded.id,username=excluded.username,display_name=excluded.display_name,avatar_url=excluded.avatar_url returning id,username,display_name,avatar_url,created_at,updated_at`,[body.id,body.username,body.display_name,body.avatar_url]);
                else rows=await sql(id,'select id,username,display_name,avatar_url,created_at,updated_at from public.profiles where id=$1',[url.searchParams.get('id')?.replace(/^eq\./,'')]);
                return json(String(req.headers.accept).includes('vnd.pgrst.object')?rows[0]||null:rows);
            }
            if(url.pathname.startsWith('/rest/v1/rpc/')){
                const name=url.pathname.split('/').pop(), parameters=procedures[name];if(!parameters)return json({message:'Unknown procedure'},404);
                const query=`select * from public.${name}(${parameters.map(([_key,type],index)=>`$${index+1}::${type}`).join(',')})`,args=parameters.map(([key])=>body[key]);
                const rows=privateInvite?await privateSql(query,args):await sql(id,query,args);
                return json(name==='search_people'?rows:name==='friend_ids'?rows.map(row=>row.friend_ids):rows[0]?.[name]??null);
            }
            return json({message:'Not found'},404);
        }catch(error){return json({code:error.code||'P0001',message:error.message},400);}
    });
    realtime = realtimeFixture.transport({server,db,tokens,asUser:rawSql});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    return {url:`http://127.0.0.1:${server.address().port}`,key:'public-test-only',serviceKey:'service-role-test-only',A,B,C,sql,requests,realtime,
        adminSql:async(text,args=[])=>{const rows=(await db.query(text,args)).rows;await realtime.flush();return rows;},
        adminExec:text=>db.exec(text),
        roleSql:(role,text,args=[])=>db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return(await tx.query(text,args)).rows;}),
        topicSql:(id,topic,text,args=[])=>db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('realtime.topic',$2,true)",[id,topic]);return(await tx.query(text,args)).rows;}),
        setGoogleId:id=>{googleId=id;},revokeAccount:id=>{revokedRefresh.add(id);for(const[token,owner]of tokens)if(owner===id)tokens.delete(token);},close:async()=>{await realtime.close();await new Promise(resolve=>server.close(resolve));await db.close();}};
};
