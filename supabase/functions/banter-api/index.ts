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

 const profile=async(id:string)=>{const r=await db.from("profiles").select("*").eq("user_id",id).maybeSingle();return r.data??null};
 const pair=(a:string,b:string)=>a<b?[a,b]:[b,a];
 const areFriends=async(a:string,b:string)=>{const [x,y]=pair(a,b);const r=await db.from("friendships").select("user_a").eq("user_a",x).eq("user_b",y).maybeSingle();return !!r.data};
 const isBlocked=async(a:string,b:string)=>{const r=await db.from("blocks").select("blocker_id").or(`and(blocker_id.eq.${a},blocked_id.eq.${b}),and(blocker_id.eq.${b},blocked_id.eq.${a})`).limit(1);return !!r.data?.length};
 const roleFor=async(cid:string,uid:string)=>{const r=await db.from("conversation_members").select("role").eq("conversation_id",cid).eq("user_id",uid).is("left_at",null).maybeSingle();return r.data?.role??null};
 const notify=async(uid:string,kind:string,title:string,message:string,href:string)=>{await db.from("notifications").insert({id:crypto.randomUUID(),user_id:uid,kind,title,body:message,href})};
 const rateAllowed=async(action:string,limit:number,windowMs:number)=>{const cutoff=new Date(Date.now()-windowMs).toISOString();const q=await db.from("rate_events").select("id",{count:"exact",head:true}).eq("user_id",user.id).eq("action",action).gt("created_at",cutoff);if((q.count??0)>=limit)return false;const ins=await db.from("rate_events").insert({user_id:user.id,action});return !ins.error};
 const active=async()=>{const p=await profile(user.id);if(!p)return {p:null,error:"Profile missing."};if(!p.onboarding_complete)return {p,error:"Finish setting up your Banter profile first."};if(p.status==="suspended")return {p,error:"This account is suspended."};if(p.status==="deactivated")return {p,error:"Reactivate your account to do that."};if(p.status!=="active")return {p,error:"This account is not active."};return {p,error:null as string|null}};

 const parseList=(v:unknown):string[]=>{if(Array.isArray(v))return v.filter((x):x is string=>typeof x==="string");if(typeof v!=="string")return [];try{const x=JSON.parse(v);return Array.isArray(x)?x.filter((y):y is string=>typeof y==="string"):[]}catch{return []}};
 const parseSocials=(v:unknown)=>{if(typeof v!=="string")return [];try{const x=JSON.parse(v);return Array.isArray(x)?x.filter(y=>y&&typeof y.label==="string"&&typeof y.url==="string").slice(0,8):[]}catch{return []}};
 const mapMe=(p:Record<string,any>)=>({userId:p.user_id,username:p.username,displayName:p.display_name,bio:p.bio,about:p.about,avatarUrl:p.avatar_url,birthday:p.birthday,location:p.location,interests:parseList(p.interests),hobbies:p.hobbies,socials:parseSocials(p.socials),discoverability:p.discoverability,lastSeenVisibility:p.last_seen_visibility,showOnline:p.show_online,readReceipts:p.read_receipts,theme:p.theme==="light"?"light":"dark",status:p.status,role:p.role==="admin"?"admin":"user",onboardingComplete:p.onboarding_complete,notifyMessages:p.notify_messages,notifyFriends:p.notify_friends,notifyStories:p.notify_stories,lastSeenAt:p.last_seen_at,usernameChangedAt:p.username_changed_at,createdAt:p.created_at,email:user.email??""});
 const mapPublic=(p:Record<string,any>,rel:string,mine:string[])=>({userId:p.user_id,username:p.username,displayName:p.status==="deactivated"?"Deactivated account":p.display_name,bio:p.status==="active"?p.bio:"",about:rel==="friends"&&p.status==="active"?p.about:"",avatarUrl:p.status==="active"?p.avatar_url:null,interests:p.status==="active"?parseList(p.interests):[],hobbies:rel==="friends"?p.hobbies:"",location:rel==="friends"?p.location:"",birthday:rel==="friends"?p.birthday:null,socials:rel==="friends"?parseSocials(p.socials):[],createdAt:p.created_at,relationship:rel,sharedInterests:parseList(p.interests).filter(x=>mine.includes(x)),online:!!p.show_online&&p.status==="active"&&!!p.last_seen_at&&Date.now()-new Date(p.last_seen_at).getTime()<45000,lastSeenAt:p.last_seen_visibility==="nobody"||p.last_seen_visibility==="friends"&&rel!=="friends"?null:p.last_seen_at,canMessage:rel==="friends"&&p.status==="active"});
 const relationship=async(other:string)=>{if(await isBlocked(user.id,other))return "blocked";if(await areFriends(user.id,other))return "friends";const r=await db.from("friend_requests").select("from_user_id").eq("status","pending").or(`and(from_user_id.eq.${user.id},to_user_id.eq.${other}),and(from_user_id.eq.${other},to_user_id.eq.${user.id})`).limit(1);if(!r.data?.length)return "none";return r.data[0].from_user_id===user.id?"pending-out":"pending-in"};
 if(body.action==="search_people"){
  const me=await profile(user.id);if(!me?.onboarding_complete)return reply(403,{ok:false,error:"Finish your profile first."});const q=(typeof d.q==="string"?d.q:"").trim().toLowerCase().replace(/^@/,"").replace(/[\\%_]/g,"");if(q.length<2)return reply(200,{ok:true,people:[]});
  const r=await db.from("profiles").select("*").eq("onboarding_complete",true).eq("status","active").neq("user_id",user.id).not("username","is",null).neq("discoverability","nobody").like("username",q+"%").order("username",{ascending:true}).limit(15);if(r.error)return reply(400,{ok:false,error:"Could not search people."});const mine=parseList(me.interests),people=[];
  for(const p of r.data??[]){if(await isBlocked(user.id,p.user_id))continue;const rel=await relationship(p.user_id);if(p.discoverability==="friends"&&rel!=="friends"&&p.username!==q)continue;people.push(mapPublic(p,rel,mine))}
  people.sort((a,b)=>Number(b.username===q)-Number(a.username===q));return reply(200,{ok:true,people});
 }
 if(body.action==="get_profile"){
  const me=await profile(user.id);if(!me)return reply(404,{ok:false,error:"Profile missing."});let p=null;if(typeof d.userId==="string")p=await profile(d.userId);else if(typeof d.username==="string"){const n=cleanUsername(d.username);if(!n)return reply(400,{ok:false,error:"That Banter ID is not valid."});const r=await db.from("profiles").select("*").eq("username",n).maybeSingle();p=r.data}
  if(!p||!p.onboarding_complete)return reply(404,{ok:false,error:"No one uses that Banter ID."});if(p.user_id===user.id)return reply(200,{ok:true,self:true,me:mapMe(p)});const isFriend=await areFriends(user.id,p.user_id);if(p.discoverability==="nobody"&&!isFriend)return reply(403,{ok:false,error:"This profile is not available."});if(await isBlocked(user.id,p.user_id)){const mineBlocked=!!(await db.from("blocks").select("blocked_id").eq("blocker_id",user.id).eq("blocked_id",p.user_id).maybeSingle()).data;return reply(200,{ok:true,self:false,person:{...mapPublic(p,"blocked",[]),displayName:mineBlocked?p.display_name:"Unavailable",bio:"",about:"",avatarUrl:null,interests:[],blockedByMe:mineBlocked,canMessage:false}})}
  const rel=await relationship(p.user_id);return reply(200,{ok:true,self:false,person:{...mapPublic(p,rel,parseList(me.interests)),blockedByMe:false}});
 }
 if(body.action==="friend_action"){
  const gate=await active();if(gate.error)return reply(403,{ok:false,error:gate.error});const other=typeof d.userId==="string"?d.userId:"",action=d.actionType;if(!other||other===user.id||!["request","accept","reject","cancel","remove","block","unblock"].includes(String(action)))return reply(400,{ok:false,error:"Invalid friend action."});const them=await profile(other);if(!them)return reply(404,{ok:false,error:"That person is not available."});
  if(action==="unblock"){const r=await db.from("blocks").delete().eq("blocker_id",user.id).eq("blocked_id",other);return reply(r.error?400:200,r.error?{ok:false,error:"Could not unblock."}:{ok:true})}
  if(action==="block"){if(!await rateAllowed("block",30,3600000))return reply(429,{ok:false,error:"Slow down a moment."});const b=await db.from("blocks").upsert({blocker_id:user.id,blocked_id:other},{onConflict:"blocker_id,blocked_id",ignoreDuplicates:true});if(b.error)return reply(400,{ok:false,error:"Could not block this person."});const [x,y]=pair(user.id,other);await db.from("friendships").delete().eq("user_a",x).eq("user_b",y);await db.from("friend_requests").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("status","pending").or(`and(from_user_id.eq.${user.id},to_user_id.eq.${other}),and(from_user_id.eq.${other},to_user_id.eq.${user.id})`);return reply(200,{ok:true})}
  if(await isBlocked(user.id,other))return reply(403,{ok:false,error:"You can't reach this person."});
  if(action==="request"){if(them.status!=="active")return reply(400,{ok:false,error:"That account is not accepting requests."});if(await areFriends(user.id,other))return reply(400,{ok:false,error:"You're already friends."});if(!await rateAllowed("friend",20,3600000))return reply(429,{ok:false,error:"Too many requests. Try again later."});const r=await db.from("friend_requests").select("*").or(`and(from_user_id.eq.${user.id},to_user_id.eq.${other}),and(from_user_id.eq.${other},to_user_id.eq.${user.id})`).order("created_at",{ascending:false}).limit(1);const existing=r.data?.[0];if(existing?.status==="pending"&&existing.from_user_id===other){await db.from("friend_requests").update({status:"accepted",updated_at:new Date().toISOString()}).eq("id",existing.id);const [x,y]=pair(user.id,other);await db.from("friendships").upsert({user_a:x,user_b:y},{onConflict:"user_a,user_b",ignoreDuplicates:true});return reply(200,{ok:true})}if(existing?.status==="pending")return reply(400,{ok:false,error:"Request already sent."});const payload={id:existing?.id??crypto.randomUUID(),from_user_id:user.id,to_user_id:other,status:"pending",updated_at:new Date().toISOString()};const wr=existing?await db.from("friend_requests").update(payload).eq("id",existing.id):await db.from("friend_requests").insert(payload);if(wr.error)return reply(400,{ok:false,error:"Could not send friend request."});return reply(200,{ok:true})}
  const query=action==="cancel"?db.from("friend_requests").update({status:"cancelled",updated_at:new Date().toISOString()}).eq("from_user_id",user.id).eq("to_user_id",other).eq("status","pending"):action==="reject"?db.from("friend_requests").update({status:"rejected",updated_at:new Date().toISOString()}).eq("from_user_id",other).eq("to_user_id",user.id).eq("status","pending"):null;
  if(query){const wr=await query;if(wr.error)return reply(400,{ok:false,error:"Could not update friend request."});return reply(200,{ok:true})}
  if(action==="accept"){const r=await db.from("friend_requests").select("id").eq("from_user_id",other).eq("to_user_id",user.id).eq("status","pending").maybeSingle();if(!r.data)return reply(400,{ok:false,error:"That request is no longer open."});await db.from("friend_requests").update({status:"accepted",updated_at:new Date().toISOString()}).eq("id",r.data.id);const [x,y]=pair(user.id,other);const wr=await db.from("friendships").upsert({user_a:x,user_b:y},{onConflict:"user_a,user_b",ignoreDuplicates:true});if(wr.error)return reply(400,{ok:false,error:"Could not accept request."});return reply(200,{ok:true})}
  if(action==="remove"){const [x,y]=pair(user.id,other);const wr=await db.from("friendships").delete().eq("user_a",x).eq("user_b",y);if(wr.error)return reply(400,{ok:false,error:"Could not remove friend."});return reply(200,{ok:true})}
 }
 if(body.action==="set_account_status"){
  const status=d.status;if(!["active","deactivated"].includes(String(status)))return reply(400,{ok:false,error:"Invalid account status."});
  const p=await profile(user.id);if(!p)return reply(400,{ok:false,error:"Profile missing."});if(p.status==="suspended")return reply(403,{ok:false,error:"Suspended accounts cannot reactivate themselves."});
  const r=await db.from("profiles").update({status}).eq("user_id",user.id);if(r.error)return reply(400,{ok:false,error:"Could not update account status."});return reply(200,{ok:true});
 }
 if(body.action==="appeal"){
  const p=await profile(user.id),message=typeof d.body==="string"?d.body.trim():"";if(!p||p.status!=="suspended")return reply(400,{ok:false,error:"Appeals are for suspended accounts."});if(message.length<8||message.length>800)return reply(400,{ok:false,error:"Appeal must be 8–800 characters."});if(!await rateAllowed("appeal",3,86400000))return reply(429,{ok:false,error:"You already sent an appeal recently."});
  const r=await db.from("appeals").insert({id:crypto.randomUUID(),user_id:user.id,body:message});if(r.error)return reply(400,{ok:false,error:"Could not submit appeal."});return reply(200,{ok:true});
 }
 if(body.action==="report_person"){
  const gate=await active();if(gate.error)return reply(403,{ok:false,error:gate.error});const reason=typeof d.reason==="string"?d.reason.trim():"",details=typeof d.details==="string"?d.details.trim().slice(0,500):"";if(reason.length<3||reason.length>80||(!d.userId&&!d.conversationId))return reply(400,{ok:false,error:"Enter a valid report."});if(!await rateAllowed("report",10,86400000))return reply(429,{ok:false,error:"You've sent several reports. Try again tomorrow."});
  const r=await db.from("reports").insert({id:crypto.randomUUID(),reporter_id:user.id,target_user_id:typeof d.userId==="string"?d.userId:null,target_conversation_id:typeof d.conversationId==="string"?d.conversationId:null,reason,details});if(r.error)return reply(400,{ok:false,error:"Could not submit report."});return reply(200,{ok:true});
 }
 if(body.action==="mark_notices"){
  let q=db.from("notifications").update({read_at:new Date().toISOString()}).eq("user_id",user.id);if(typeof d.id==="string")q=q.eq("id",d.id);else q=q.is("read_at",null);const r=await q;if(r.error)return reply(400,{ok:false,error:"Could not update notifications."});return reply(200,{ok:true});
 }
 if(body.action==="pulse_typing"){
  if(typeof d.conversationId!=="string"||typeof d.typing!=="boolean")return reply(400,{ok:false,error:"Invalid typing update."});if(!await roleFor(d.conversationId,user.id))return reply(403,{ok:false,error:"Not a member."});
  const r=d.typing?await db.from("typing").upsert({conversation_id:d.conversationId,user_id:user.id,updated_at:new Date().toISOString()}):await db.from("typing").delete().eq("conversation_id",d.conversationId).eq("user_id",user.id);if(r.error)return reply(400,{ok:false,error:"Could not update typing status."});return reply(200,{ok:true});
 }
 if(body.action==="post_story"){
  const gate=await active();if(gate.error)return reply(403,{ok:false,error:gate.error});const kind=d.kind,bodyText=typeof d.body==="string"?d.body.trim():"";if(!["text","image"].includes(String(kind)))return reply(400,{ok:false,error:"Invalid story type."});if(!await rateAllowed("story",12,86400000))return reply(429,{ok:false,error:"Story limit for today reached."});
  let media:string|null=null;if(kind==="image"){const raw=typeof d.mediaData==="string"?d.mediaData.split(",").pop()??"":"";if(!["image/jpeg","image/png","image/webp"].includes(String(d.mediaMime))||!raw||Math.floor(raw.length*.75)>380000)return reply(400,{ok:false,error:"Use a JPG, PNG, or WebP under 380 KB."});media=raw}else if(!bodyText||bodyText.length>240)return reply(400,{ok:false,error:"Write a status up to 240 characters."});
  const id=crypto.randomUUID(),expires=new Date(Date.now()+86400000).toISOString();const r=await db.from("stories").insert({id,user_id:user.id,kind,body:bodyText,media_data:media,bg:["clay","ink","sage","dusk","apricot"].includes(String(d.bg))?d.bg:"clay",expires_at:expires});if(r.error)return reply(400,{ok:false,error:"Could not post story."});return reply(200,{ok:true,id});
 }
 if(body.action==="stories_for"){
  if(typeof d.userId!=="string")return reply(400,{ok:false,error:"Choose a profile."});if(d.userId!==user.id&&!await areFriends(user.id,d.userId))return reply(403,{ok:false,error:"Stories are visible to friends."});
  const r=await db.from("stories").select("id,kind,body,bg,created_at,expires_at,media_data").eq("user_id",d.userId).gt("expires_at",new Date().toISOString()).order("created_at",{ascending:true});if(r.error)return reply(400,{ok:false,error:"Could not load stories."});
  const ids=(r.data??[]).map(x=>x.id);if(d.userId!==user.id&&ids.length)await db.from("story_views").upsert(ids.map(story_id=>({story_id,viewer_id:user.id})),{onConflict:"story_id,viewer_id",ignoreDuplicates:true});
  const views=ids.length?await db.from("story_views").select("story_id").in("story_id",ids):{data:[]};const reactions=ids.length?await db.from("story_reactions").select("story_id,emoji").in("story_id",ids):{data:[]};
  return reply(200,{ok:true,stories:(r.data??[]).map(x=>({id:x.id,kind:x.kind,body:x.body,bg:x.bg,hasMedia:!!x.media_data,createdAt:x.created_at,expiresAt:x.expires_at,views:d.userId===user.id?(views.data??[]).filter(v=>v.story_id===x.id).length:0,reactions:[...new Set((reactions.data??[]).filter(v=>v.story_id===x.id).map(v=>v.emoji))].map(emoji=>({emoji,count:(reactions.data??[]).filter(v=>v.story_id===x.id&&v.emoji===emoji).length}))}))});
 }
 if(body.action==="story_media"){
  if(typeof d.storyId!=="string")return reply(400,{ok:false,error:"Story unavailable."});const r=await db.from("stories").select("user_id,media_data").eq("id",d.storyId).gt("expires_at",new Date().toISOString()).maybeSingle();if(!r.data?.media_data)return reply(404,{ok:false,error:"Story unavailable."});if(r.data.user_id!==user.id&&!await areFriends(user.id,r.data.user_id))return reply(403,{ok:false,error:"Stories are visible to friends."});return reply(200,{ok:true,data:r.data.media_data});
 }
 if(body.action==="react_story"){
  if(typeof d.storyId!=="string"||!["♥","☺","!","…","✦","↑"].includes(String(d.emoji)))return reply(400,{ok:false,error:"That reaction is not available."});const story=await db.from("stories").select("user_id").eq("id",d.storyId).gt("expires_at",new Date().toISOString()).maybeSingle();const owner=story.data?.user_id;if(!owner)return reply(404,{ok:false,error:"Story unavailable."});if(owner!==user.id&&!await areFriends(user.id,owner))return reply(403,{ok:false,error:"Not available."});const r=await db.from("story_reactions").upsert({story_id:d.storyId,user_id:user.id,emoji:d.emoji},{onConflict:"story_id,user_id"});if(r.error)return reply(400,{ok:false,error:"Could not react to story."});if(owner!==user.id){const [op,mp]=await Promise.all([profile(owner),profile(user.id)]);if(op?.notify_stories&&mp)await notify(owner,"story","Story reaction",mp.display_name+" reacted to your story","story:"+owner)}return reply(200,{ok:true});
 }
 if(body.action==="delete_story"){
  if(typeof d.storyId!=="string")return reply(400,{ok:false,error:"Story unavailable."});const r=await db.from("stories").delete().eq("id",d.storyId).eq("user_id",user.id);if(r.error)return reply(400,{ok:false,error:"Could not delete story."});return reply(200,{ok:true});
 }
 if(body.action==="start_call"){
  const gate=await active();if(gate.error)return reply(403,{ok:false,error:gate.error});if(typeof d.userId!=="string"||!["voice","video"].includes(String(d.kind)))return reply(400,{ok:false,error:"Invalid call."});if(!await areFriends(user.id,d.userId))return reply(403,{ok:false,error:"You can call friends."});if(await isBlocked(user.id,d.userId))return reply(403,{ok:false,error:"You can't call this person."});if(!await rateAllowed("call",12,3600000))return reply(429,{ok:false,error:"Too many call attempts."});
  const id=crypto.randomUUID();const r=await db.from("calls").insert({id,caller_id:user.id,callee_id:d.userId,kind:d.kind,status:"ringing"});if(r.error)return reply(400,{ok:false,error:"Could not start call."});const cp=await profile(d.userId);if(cp?.notify_messages)await notify(d.userId,"call",d.kind==="video"?"Incoming video call":"Incoming voice call",gate.p.display_name,"call:"+id);return reply(200,{ok:true,callId:id});
 }
 if(body.action==="call_action"){
  if(typeof d.callId!=="string"||!["accept","decline","end","cancel"].includes(String(d.action)))return reply(400,{ok:false,error:"Invalid call action."});const q=await db.from("calls").select("caller_id,callee_id,status").eq("id",d.callId).maybeSingle();const c=q.data;if(!c)return reply(404,{ok:false,error:"Call not found."});if(c.caller_id!==user.id&&c.callee_id!==user.id)return reply(403,{ok:false,error:"Not your call."});
  let patch:Record<string,unknown>={};if(d.action==="accept"){if(c.callee_id!==user.id)return reply(403,{ok:false,error:"Only the person called can answer."});patch={status:"active",started_at:new Date().toISOString()}}else if(d.action==="decline"){patch={status:"declined",ended_at:new Date().toISOString()};await notify(c.caller_id,"call","Call declined","They didn't pick up","calls")}else{patch={status:d.action==="cancel"?"missed":"ended",ended_at:new Date().toISOString()};if(d.action==="cancel")await notify(c.callee_id,"call","Missed call","You missed a call","calls")}
  const u=await db.from("calls").update(patch).eq("id",d.callId);if(u.error)return reply(400,{ok:false,error:"Could not update call."});return reply(200,{ok:true,status:String(patch.status)});
 }
 if(body.action==="poll_call"){
  if(typeof d.callId!=="string")return reply(400,{ok:false,error:"Invalid call."});const c=await db.from("calls").select("caller_id,callee_id,status,kind").eq("id",d.callId).maybeSingle();if(!c.data||(c.data.caller_id!==user.id&&c.data.callee_id!==user.id))return reply(403,{ok:false,error:"Not your call."});const s=await db.from("call_signals").select("id,from_user_id,payload").eq("call_id",d.callId).gt("id",Number(d.after)||0).neq("from_user_id",user.id).order("id",{ascending:true}).limit(40);if(s.error)return reply(400,{ok:false,error:"Could not poll call."});return reply(200,{ok:true,status:c.data.status,kind:c.data.kind,signals:(s.data??[]).map(x=>({id:Number(x.id),from:x.from_user_id,payload:x.payload}))});
 }
 if(body.action==="post_signal"){
  if(typeof d.callId!=="string"||typeof d.payload!=="string"||d.payload.length>30000)return reply(400,{ok:false,error:"Invalid call signal."});const c=await db.from("calls").select("caller_id,callee_id,status").eq("id",d.callId).maybeSingle();if(!c.data||(c.data.caller_id!==user.id&&c.data.callee_id!==user.id))return reply(403,{ok:false,error:"Not your call."});if(!["active","ringing"].includes(c.data.status))return reply(400,{ok:false,error:"Call is over."});const r=await db.from("call_signals").insert({call_id:d.callId,from_user_id:user.id,payload:d.payload});if(r.error)return reply(400,{ok:false,error:"Could not send call signal."});return reply(200,{ok:true});
 }
 if(body.action==="call_log"){
  const r=await db.from("calls").select("id,caller_id,callee_id,kind,status,created_at,started_at,ended_at").or(`caller_id.eq.${user.id},callee_id.eq.${user.id}`).order("created_at",{ascending:false}).limit(40);if(r.error)return reply(400,{ok:false,error:"Could not load calls."});const ids=[...new Set((r.data??[]).flatMap(x=>[x.caller_id,x.callee_id]))];const ps=ids.length?await db.from("profiles").select("user_id,display_name").in("user_id",ids):{data:[]};const names=new Map((ps.data??[]).map(x=>[x.user_id,x.display_name]));return reply(200,{ok:true,calls:(r.data??[]).map(x=>({id:x.id,callerId:x.caller_id,calleeId:x.callee_id,peerId:x.caller_id===user.id?x.callee_id:x.caller_id,peerName:names.get(x.caller_id===user.id?x.callee_id:x.caller_id)??"Someone",kind:x.kind,status:x.status,direction:x.caller_id===user.id?"out":"in",createdAt:x.created_at,startedAt:x.started_at,endedAt:x.ended_at}))});
 }
 if(body.action==="get_me"){
  const tomb=await db.from("account_tombstones").select("user_id").eq("user_id",user.id).maybeSingle();
  if(tomb.data)return reply(200,{ok:true,tombstone:true});
  const {data,error}=await db.from("profiles").select("*").eq("user_id",user.id).maybeSingle();
  if(error||!data)return reply(400,{ok:false,error:"Could not load your profile."});
  return reply(200,{ok:true,tombstone:false,me:mapMe(data)});
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
  const existingProfile=await profile(user.id);if(!existingProfile)return reply(404,{ok:false,error:"Profile missing."});if(existingProfile.status==="suspended")return reply(403,{ok:false,error:"This account is suspended."});
  const interests=Array.isArray(d.interests)?d.interests.filter((v):v is string=>typeof v==="string").slice(0,12):[];
  const {data,error}=await db.from("profiles").update({display_name,username,bio:typeof d.bio==="string"?d.bio.trim().slice(0,160):"",about:typeof d.about==="string"?d.about.trim().slice(0,600):"",hobbies:typeof d.hobbies==="string"?d.hobbies.trim().slice(0,200):"",interests:JSON.stringify(interests),onboarding_complete:true,username_changed_at:new Date().toISOString()}).eq("user_id",user.id).select("*").single();
  if(error?.code==="23505")return reply(409,{ok:false,error:"That Banter ID is already taken."});
  if(error||!data)return reply(400,{ok:false,error:"Could not finish your profile."});
  return reply(200,{ok:true,me:mapMe(data)});
 }
 if(body.action==="update_profile"){
  const keys=["display_name","username","bio","about","hobbies","location","birthday","interests","socials","discoverability","last_seen_visibility","show_online","read_receipts","theme","avatar_url","notify_messages","notify_friends","notify_stories"];
  const patch:Record<string,unknown>={};for(const k of keys)if(Object.hasOwn(d,k))patch[k]=d[k];
  if(patch.display_name!==undefined){const n=cleanName(patch.display_name);if(!n)return reply(400,{ok:false,error:"Invalid display name."});patch.display_name=n}
  if(patch.username!==undefined){const n=cleanUsername(patch.username);if(!n)return reply(400,{ok:false,error:"Invalid Banter ID."});patch.username=n}
  if(patch.bio!==undefined&&typeof patch.bio==="string")patch.bio=patch.bio.trim().slice(0,160);
  if(patch.about!==undefined&&typeof patch.about==="string")patch.about=patch.about.trim().slice(0,600);
  if(patch.hobbies!==undefined&&typeof patch.hobbies==="string")patch.hobbies=patch.hobbies.trim().slice(0,200);
  if(patch.avatar_url!==undefined&&patch.avatar_url!==null){const av=String(patch.avatar_url);if(!av.startsWith("https://")&&!["data:image/jpeg;base64,","data:image/png;base64,","data:image/webp;base64,"].some(prefix=>av.startsWith(prefix)))return reply(400,{ok:false,error:"Invalid avatar image."});if(av.length>500000)return reply(400,{ok:false,error:"Avatar image is too large."});}
  if(patch.theme!==undefined&&!["dark","light"].includes(String(patch.theme)))return reply(400,{ok:false,error:"Invalid theme."});
  if(patch.discoverability!==undefined&&!["everyone","friends","nobody"].includes(String(patch.discoverability)))return reply(400,{ok:false,error:"Invalid discoverability setting."});
  const {data,error}=await db.from("profiles").update(patch).eq("user_id",user.id).select("*").single();
  if(error?.code==="23505")return reply(409,{ok:false,error:"That Banter ID is already taken."});
  if(error||!data)return reply(400,{ok:false,error:"Could not update your profile."});
  return reply(200,{ok:true,me:mapMe(data)});
 }
 return reply(404,{ok:false,error:"Unknown BANTER API action."});
});