"""Build 2025/26 from official TSM/stock ZIPs, retaining the 2024/25 snapshot.
Run: python scripts/import-2026.py [--download]
Inputs cached in work/2026. No council or for-profit stock is included.
"""
from pathlib import Path
import argparse,csv,hashlib,io,json,math,urllib.request,zipfile
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'work/2026';WORK.mkdir(parents=True,exist_ok=True)
URLS={'tsm':'https://assets.publishing.service.gov.uk/media/6af486ac8041fe64414e54fa/2026_TSM_Full_Dataset_FINAL_V1.1.zip','stock':'https://assets.publishing.service.gov.uk/media/6ae44a19d22fc5fecb3eb81d/PRP_Data_Release_2026_Full_Data_FINAL_V1.1.zip'}
args=argparse.ArgumentParser();args.add_argument('--download',action='store_true');a=args.parse_args()
archives={}
for key,url in URLS.items():
    path=WORK/(key+'.zip')
    if a.download or not path.exists():path.write_bytes(urllib.request.urlopen(url).read())
    archives[key]=zipfile.ZipFile(path)
def table(archive,token,offset=0):
    matches=[n for n in archives[archive].namelist() if token in n and n.endswith('.csv')];assert len(matches)==1,matches
    raw=archives[archive].read(matches[0])
    try:text=raw.decode('utf-8-sig')
    except UnicodeDecodeError:text=raw.decode('cp1252')
    return list(csv.reader(io.StringIO(text)))[offset:]
def tsm(token):
    r=table('tsm',token);return {d['ProviderNumber']:d for row in r[1:] if (d:=dict(zip(r[0],row)))['ProviderType']=='PRP'}
def num(v):
    try:
        n=float(str(v).replace(',','').strip());return n if math.isfinite(n) else None
    except (ValueError,TypeError):return None
prior=json.loads((ROOT/'public/housing.json').read_text());old={p['id']:p for p in prior['providers']};geo={a['id']:a for a in prior['areas']}
perception={t:tsm('TSM26_'+t+'_Perception') for t in ['LCRA','LCHO']};management=tsm('TSM26_Management_Info')
# Preserve the existing contextual map. Two 2025 code changes are matched by
# exact authority name; geometry remains explicitly dated December 2024.
geoAliases={}
for r in table('stock','File 04 ',4):
    if r[4].startswith('E') and r[4] not in geo:
        matches=[g for g in geo.values() if g['name']==r[3]]
        assert len(matches)==1,('Unmatched authority',r[3])
        geoAliases[r[4]]=matches[0]['id']
        geo[r[4]]={**matches[0],'id':r[4]}
areas=[g for k,g in geo.items() if k not in geoAliases.values()]
reporters=set(management)|set(perception['LCRA'])|set(perception['LCHO'])
elirows=table('stock','File 01 ',3);assert elirows[0][3]=='Type of organisation'
eli={r[1]:r for r in elirows[1:] if r[1]}
groups=table('stock','File 02 ',3);assert groups[0][11]=="Registered Parent's code"
parent={r[1]:r[11] for r in groups[1:] if r[11] in eli and r[11]!=r[1]}
def owner(k):
    seen=set()
    while k not in reporters and k in parent:
        assert k not in seen,'Cyclic group structure';seen.add(k);k=parent[k]
    return k
ops=json.loads((ROOT/'data/operational-metrics.json').read_text());providers={}
for k,r in eli.items():
    if r[3]!='Non-profit':continue
    o=owner(k)
    if eli[o][3]!='Non-profit':continue
    if o not in providers:
        current=perception['LCRA'].get(o) or management.get(o) or perception['LCHO'].get(o,{})
        p={'id':o,'name':current.get('ProviderName',eli[o][0]),'members':[],'region':current.get('Predominant region','Not reported'),'comment':current.get('RSH Comments',''),'rent':None,'rentN':0,'rentSum':0,'tenures':{},'operational':{}}
        for t,suffix in [('LCRA','a'),('LCHO','b')]:
            row=perception[t].get(o,{})
            p['tenures'][t]={'stock':0,'areas':{},'scores':[num(row.get(f'TP{i:02d}_Satisfied_Calc_{t}')) if t!='LCHO' or i not in [2,3,4] else None for i in range(1,13)],'previous':old[o]['tenures'][t]['scores'] if o in old else [None]*12,'survey':row.get('Predominant method'),'sample':num(row.get('Total_sample_size_'+suffix)),'url':row.get('Publication_URL')}
            values={m['key']:num(management.get(o,{}).get(m['key']+'_Calculated_Value'+('_'+t if m['scope']=='tenure' else ''))) if t!='LCHO' or m['scope']!='LCRA' else None for m in ops}
            previous=old.get(o,{}).get('operational',{}).get(t,{}).get('values',{m['key']:None for m in ops})
            p['operational'][t]={'values':values,'previous':previous}
        providers[o]=p
    providers[o]['members'].append(k)
member={m:p for p in providers.values() for m in p['members']}
stock=table('stock','File 04 ',3);assert 'Owned low cost rental' in stock[0][5] and stock[0][14].startswith('Owned -')
for r in stock[1:]:
    p=member.get(r[1])
    if not p:continue
    for t,columns in [('LCRA',[5,6,7,8]),('LCHO',[14])]:
        n=int(sum(num(r[i]) or 0 for i in columns));v=p['tenures'][t];v['stock']+=n
        if n and r[4].startswith('E'):
            assert r[4] in geo,('Unmapped LA',r[4]);v['areas'][r[4]]=v['areas'].get(r[4],0)+n
rents=table('stock','File 09 ',3);assert 'Total units/bedspaces' in rents[0][69] and 'NET rent' in rents[0][70]
for r in rents[1:]:
    p=member.get(r[1]);n=num(r[69]);v=num(r[70])
    if p and n and v is not None:p['rentN']+=n;p['rentSum']+=n*v
for p in providers.values():
    p['rent']=round(p.pop('rentSum')/p['rentN'],2) if p['rentN'] else None;p.pop('rentN')
    p['stock']=sum(t['stock'] for t in p['tenures'].values());combined={}
    for t in p['tenures'].values():
        for k,v in t['areas'].items():combined[k]=combined.get(k,0)+v
    p['areas']=combined
    for v in [p,*p['tenures'].values()]:
        n=sum(v['areas'].values());v['unlocatedStock']=v['stock']-n
        v['lon']=sum(geo[k]['lon']*stock for k,stock in v['areas'].items())/n if n else None
        v['lat']=sum(geo[k]['lat']*stock for k,stock in v['areas'].items())/n if n else None
        v['areas']=[{'id':k,'name':geo[k]['name'],'stock':n} for k,n in sorted(v['areas'].items(),key=lambda kv:-kv[1])]
    for k in ['scores','previous','sample','survey','url']:p[k]=p['tenures']['LCRA'][k]
ps=sorted([p for p in providers.values() if p['stock']>0],key=lambda p:-p['stock'])
missing=sorted(k for k in reporters if k in eli and eli[k][3]=='Non-profit' and k not in {p['id'] for p in ps})
assert not missing,('Non-profit reporting providers missing stock',missing)
data={'dataYear':'2025/26','stockDate':'2026-03-31','previousYear':'2024/25','providers':ps,'areas':areas,'sources':{k:{'url':u,'sha256':hashlib.sha256((WORK/(k+'.zip')).read_bytes()).hexdigest()} for k,u in URLS.items()},'downloaded':'2026-11-20','previousSourceSha256':hashlib.sha256((ROOT/'public/housing.json').read_bytes()).hexdigest(),'geography':'ONS December 2024 contextual geometry; Barnsley and Sheffield 2025 codes matched by exact authority name, approximate historical footprints','geographyCodeAliases':geoAliases,'previousComparison':'Exact registration-code match to retained 2024/25 snapshot, without merger adjustments'}
(ROOT/'public/housing-2025-26.json').write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False,allow_nan=False)+'\n')
print('Providers',len(ps),'owned stock',sum(p['stock'] for p in ps),'regions',sorted({p['region'] for p in ps}))
for t in ['LCRA','LCHO']:print(t,'TP01',sum(p['tenures'][t]['scores'][0] is not None for p in ps))
