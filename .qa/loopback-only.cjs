const net=require("node:net"),fs=require("node:fs");
const original=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let a=Array.isArray(args[0])?args[0]:args,first=a[0],host;
 if(first&&typeof first==="object"){
  if(first.path)return original.apply(this,args);
  host=first.host??first.hostname??"localhost";
 }else if(typeof first==="number"||(typeof first==="string"&&/^\d+$/.test(first)))host=typeof a[1]==="string"?a[1]:"localhost";
 else return original.apply(this,args);
 if(typeof host==="string"&&!(host==="localhost"||host==="::1"||host==="[::1]"||/^127\.\d+\.\d+\.\d+$/.test(host))){
  if(process.env.IPGEO_QA_NETWORK_BLOCK_LOG)fs.appendFileSync(process.env.IPGEO_QA_NETWORK_BLOCK_LOG,JSON.stringify({pid:process.pid,reason:"non-loopback connection prevented"})+"\n");
  throw new Error("Non-loopback network access blocked by isolated QA guard");
 }
 return original.apply(this,args);
};
