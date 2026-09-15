export type Pair={x:number;y:number;id:string;name:string};
export function ranks(values:number[]):number[]{const order=values.map((value,i)=>({value,i})).sort((a,b)=>a.value-b.value);const out:number[]=[];for(let i=0;i<order.length;){let j=i+1;while(j<order.length&&order[j].value===order[i].value)j++;for(let k=i;k<j;k++)out[order[k].i]=(i+j+1)/2;i=j}return out}
export function pairStats(pairs:Pair[],method='pearson'){
 const n=pairs.length;if(n<3)return null;
 const calc=(xs:number[],ys:number[])=>{const mx=xs.reduce((a,b)=>a+b,0)/n,my=ys.reduce((a,b)=>a+b,0)/n;let xx=0,yy=0,xy=0;xs.forEach((x,i)=>{xx+=(x-mx)**2;yy+=(ys[i]-my)**2;xy+=(x-mx)*(ys[i]-my)});return {mx,my,xx,yy,xy}};
 const xs=pairs.map(p=>p.x),ys=pairs.map(p=>p.y),raw=calc(xs,ys),c=method==='spearman'?calc(ranks(xs),ranks(ys)):raw;
 if(!c.xx||!c.yy)return null;
 return {n,r:Math.max(-1,Math.min(1,c.xy/Math.sqrt(c.xx*c.yy))),slope:raw.xy/raw.xx,intercept:raw.my-raw.xy/raw.xx*raw.mx};
}
