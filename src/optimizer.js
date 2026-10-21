// Illustrative district demand; not an official population dataset or parcel inventory.
export const districts = [
 ['Çankaya',39.895,32.855,950000],['Keçiören',40.005,32.866,940000],['Yenimahalle',39.979,32.789,710000],['Mamak',39.925,32.925,680000],['Etimesgut',39.947,32.665,620000],['Sincan',39.967,32.575,590000],['Altındağ',39.966,32.902,410000],['Gölbaşı',39.79,32.805,160000],['Pursaklar',40.041,32.9,165000],['Akyurt',40.13,33.08,45000],['Çubuk',40.23,33.03,100000],['Polatlı',39.58,32.14,130000],['Beypazarı',40.17,31.92,50000],['Elmadağ',39.92,33.23,45000],['Kahramankazan',40.205,32.68,65000],['Şereflikoçhisar',38.94,33.54,34000],['Haymana',39.435,32.497,27000],['Nallıhan',40.185,31.351,27000],['Kızılcahamam',40.47,32.65,27000],['Bala',39.55,33.12,21000],['Ayaş',40.02,32.33,13000],['Kalecik',40.1,33.41,13000],['Güdül',40.21,32.245,9000],['Çamlıdere',40.49,32.475,9000],['Evren',39.02,33.81,3000]
].map(([name,lat,lng,pop])=>({name,lat,lng,pop}));
export const candidates = districts.flatMap((d,i)=>Array.from({length:3},(_,j)=>({id:i*3+j,name:`${d.name} ${['Batı','Merkez','Doğu'][j]}`,district:d.name,lat:d.lat+(j-1)*.008,lng:d.lng+(j-1)*.014,area:10000,land:20+(i%7)*4+j*3})));
export function distance(a,b){const r=Math.PI/180;const x=(a.lng-b.lng)*r*Math.cos((a.lat+b.lat)/2*r),y=(a.lat-b.lat)*r;return 6371*Math.hypot(x,y);}
export function evaluate(vector,p){
 const sites=[];const used=new Set();
 for(let i=0;i<p.count;i++){let id=Math.min(candidates.length-1,Math.floor(vector[i*2]*candidates.length));while(used.has(id))id=(id+1)%candidates.length;used.add(id);sites.push({...candidates[id],beds:Math.round((100+vector[i*2+1]*400)/25)*25,load:0});}
 let total=0,covered=0,weighted=0;
 const assignments=districts.map(d=>{let best=0,min=Infinity;sites.forEach((s,i)=>{let dist=distance(d,s);if(dist<min){best=i;min=dist;}});const demand=d.pop*p.bedsPerThousand/1000;sites[best].load+=demand;total+=d.pop;weighted+=d.pop*min;if(min<=p.radius)covered+=d.pop;return {...d,site:best,distance:min,demand};});
 const cost=sites.reduce((a,s)=>a+s.land+160+s.beds*p.unitCost,0);
 const shortage=sites.reduce((a,s)=>a+Math.max(0,s.load-s.beds),0)/Math.max(1,total*p.bedsPerThousand/1000);
 const coverage=covered/total,avgDistance=weighted/total;
 const score=(p.weight/100)*(cost/5000)+(1-p.weight/100)*((1-coverage)*2+avgDistance/30+shortage*2);
 return {sites,assignments,cost,coverage,avgDistance,shortage,score,totalBeds:sites.reduce((a,s)=>a+s.beds,0)};
}
export async function optimize(p,onProgress,signal){
 const size=36,dim=p.count*2;let pop=Array.from({length:size},()=>Array.from({length:dim},()=>Math.random()));let scores=pop.map(v=>evaluate(v,p));let history=[];
 for(let gen=0;gen<p.generations;gen++){
 if(signal?.aborted)throw new Error('cancelled');
 for(let i=0;i<size;i++){const ids=[];while(ids.length<3){const n=Math.floor(Math.random()*size);if(n!==i&&!ids.includes(n))ids.push(n);}const forced=Math.floor(Math.random()*dim);const trial=pop[i].map((v,j)=>Math.random()<.8||j===forced?Math.min(.999999,Math.max(0,pop[ids[0]][j]+.65*(pop[ids[1]][j]-pop[ids[2]][j]))):v);const result=evaluate(trial,p);if(result.score<=scores[i].score){pop[i]=trial;scores[i]=result;}}
 const best=scores.reduce((a,b)=>a.score<b.score?a:b);history.push(best.score);
 if(gen%4===0||gen===p.generations-1){onProgress({progress:(gen+1)/p.generations,result:best,history:[...history]});await new Promise(r=>setTimeout(r,8));}
 }return scores.reduce((a,b)=>a.score<b.score?a:b);
}
