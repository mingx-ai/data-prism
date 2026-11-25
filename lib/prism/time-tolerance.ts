const pattern=/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?$/;
function parse(value:string){
 const m=pattern.exec(value);if(!m)return null;
 const base=`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`,date=new Date(base);
 if(!Number.isFinite(date.getTime())||date.getUTCFullYear()!==Number(m[1])||date.getUTCMonth()+1!==Number(m[2])||date.getUTCDate()!==Number(m[3])||date.getUTCHours()!==Number(m[4])||date.getUTCMinutes()!==Number(m[5])||date.getUTCSeconds()!==Number(m[6]))return null;
 let offset=0;const zone=m[8];if(zone&&zone!=='Z'){const h=Number(zone.slice(1,3)),minute=Number(zone.slice(4));if(h>18||minute>59||(h===18&&minute!==0))return null;offset=(h*60+minute)*60*(zone[0]==='-'?-1:1);}
 return {zoned:!!zone,nanos:BigInt(date.getTime()/1000-offset)*1000000000n+BigInt((m[7]||'').padEnd(9,'0'))};
}
export function timeDeltaSeconds(left:string,right:string):string|null{
 const a=parse(left),b=parse(right);if(!a||!b||a.zoned!==b.zoned)return null;
 const d=a.nanos>b.nanos?a.nanos-b.nanos:b.nanos-a.nanos,fraction=(d%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
 return (d/1000000000n).toString()+(fraction?'.'+fraction:'');
}
