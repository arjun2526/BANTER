import { createClient } from "npm:@supabase/supabase-js@2.90.1";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:Record<string,unknown>)=>new Response(JSON.stringify(body),{status,headers:cors});
const cleanUsername=(v:unknown)=>typeof v==="string"&&/^[a-z0-9_]{3,20}$/.test(v.trim().toLowerCase().replace(/^@/,""))?v.trim().toLowerCase().replace(/^@/,""):null;
const cleanName=(v:unknown)=>{if(typeof v!=="string")return null;const n=v.trim().replace(/\s+/g," ");return n.length>=1&&n.length<=40?n:null};
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply(405,{ok:false,error:"Method not allowed."});
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY"),auth=req.headers.get("Authorization");
 if(!url||!key||!auth)return reply(401,{ok:false,error:"Sign in to continue."});
 const db=createClient(url,key,{global:{headers:{Authorization:auth}},auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error:authError}=await db.auth.getUser();
 if(authError||!user)return reply(401,{ok:false,error:"Your session is invalid. Sign in again."});
 let body:{action?:string;data?:Record<string,unknown>};try{body=await req.json()}catch{return reply(400,{ok:false,error:"Invalid request body."})}
 const d=body.data??{};
 if(body.action==="get_me"){
  const {data,error}=await db.from("profiles").select("*").eq("user_id",user.id).maybeSingle();
  if(error)return reply(400,{ok:false,error:"Could not load your profile."});
  return reply(200,{ok:true,profile:data,email:user.email??null});
 }
 if(body.action==="check_username"){
  const username=cleanUsername(d.username);if(!username)return reply(200,{ok:true,available:false,username:null});
  const {data,error}=await db.from("profiles").select("user_id").eq("username",username).neq("user_id",user.id).limit(1);
  if(error)return reply(400,{ok:false,error:"Could not check that Banter ID."});
  return reply(200,{ok:true,available:data.length===0,username});
 }
 if(body.action==="complete_onboarding"){
  const display_name=cleanName(d.displayName),username=cleanUsername(d.username);
  if(!display_name||!username)return reply(400,{ok:false,error:"Enter a valid name and Banter ID."});
  const interests=Array.isArray(d.interests)?d.interests.filter((v):v is string=>typeof v==="string").slice(0,12):[];
  const {data,error}=await db.from("profiles").update({display_name,username,bio:typeof d.bio==="string"?d.bio.trim().slice(0,160):"",about:typeof d.about==="string"?d.about.trim().slice(0,600):"",interests:JSON.stringify(interests),onboarding_complete:true,username_changed_at:new Date().toISOString()}).eq("user_id",user.id).select("*").single();
  if(error?.code==="23505")return reply(409,{ok:false,error:"That Banter ID is already taken."});
  if(error||!data)return reply(400,{ok:false,error:"Could not finish your profile."});
  return reply(200,{ok:true,profile:data});
 }
 if(body.action==="update_profile"){
  const keys=["display_name","username","bio","about","hobbies","location","birthday","interests","socials","discoverability","last_seen_visibility","show_online","read_receipts","theme","notify_messages","notify_friends","notify_stories"];
  const patch:Record<string,unknown>={};for(const k of keys)if(Object.hasOwn(d,k))patch[k]=d[k];
  if(patch.display_name!==undefined){const n=cleanName(patch.display_name);if(!n)return reply(400,{ok:false,error:"Invalid display name."});patch.display_name=n}
  if(patch.username!==undefined){const n=cleanUsername(patch.username);if(!n)return reply(400,{ok:false,error:"Invalid Banter ID."});patch.username=n}
  if(patch.bio!==undefined&&typeof patch.bio==="string")patch.bio=patch.bio.trim().slice(0,160);
  if(patch.about!==undefined&&typeof patch.about==="string")patch.about=patch.about.trim().slice(0,600);
  if(patch.theme!==undefined&&!["dark","light"].includes(String(patch.theme)))return reply(400,{ok:false,error:"Invalid theme."});
  if(patch.discoverability!==undefined&&!["everyone","friends","nobody"].includes(String(patch.discoverability)))return reply(400,{ok:false,error:"Invalid discoverability setting."});
  const {data,error}=await db.from("profiles").update(patch).eq("user_id",user.id).select("*").single();
  if(error?.code==="23505")return reply(409,{ok:false,error:"That Banter ID is already taken."});
  if(error||!data)return reply(400,{ok:false,error:"Could not update your profile."});
  return reply(200,{ok:true,profile:data});
 }
 return reply(404,{ok:false,error:"Unknown BANTER API action."});
});