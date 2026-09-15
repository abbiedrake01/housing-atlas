"""Join published management TSMs by reporting-provider code (no aggregation).
Usage: python scripts/import-operational.py --current CSV --previous XLSX
Requires openpyxl. Source URLs and input hashes are recorded in housing.json.
"""
import argparse,csv,hashlib,json,math
from pathlib import Path
import openpyxl
ROOT=Path(__file__).resolve().parents[1]
a=argparse.ArgumentParser();a.add_argument('--current',type=Path,required=True);a.add_argument('--previous',type=Path,required=True);args=a.parse_args()
metrics=json.loads((ROOT/'data/operational-metrics.json').read_text())
rows=list(csv.DictReader(args.current.open(encoding='utf-8-sig')))
lookup={r['ProviderNumber']:r for r in rows if r['ProviderType']=='PRP'}
assert len(lookup)==sum(r['ProviderType']=='PRP' for r in rows)
old=list(openpyxl.load_workbook(args.previous,read_only=True,data_only=True)['TSM24_Management_Info'].values)
headers=old[2];previous={r[1]:dict(zip(headers,r)) for r in old[3:] if r[2]=='PRP'}
def number(v):
    try:
        n=float(v)
        return n if math.isfinite(n) else None
    except (ValueError,TypeError):return None
source=ROOT/'public/housing.json';data=json.loads(source.read_text())
for p in data['providers']:
    p['operational']={}
    for tenure in ['LCRA','LCHO']:
        values={};prior={}
        for m in metrics:
            key=m['key'];suffix='_'+tenure if m['scope']=='tenure' else ''
            applicable=not (tenure=='LCHO' and m['scope']=='LCRA')
            values[key]=number(lookup.get(p['id'],{}).get(key+'_Calculated_Value'+suffix)) if applicable else None
            token='('+key.replace('_',' ')+')'
            matches=[h for h in headers if h and token in h and (h.startswith(tenure+' - ') if m['scope']=='tenure' else not h.startswith(('LCRA - ','LCHO - ','Combined - ')))]
            assert len(matches)==1,(key,matches)
            prior[key]=number(previous.get(p['id'],{}).get(matches[0])) if applicable else None
        p['operational'][tenure]={'values':values,'previous':prior}
data['operationalSource']={'year':'2024/25','previousYear':'2023/24','join':'Exact reporting-provider registration code; no member rate aggregation; no combined complaints fallback','currentURL':'https://assets.publishing.service.gov.uk/media/6939474f7a605b2d61cd901a/TSM_2025_Full_Data.zip','previousURL':'https://assets.publishing.service.gov.uk/media/69394574e447374889cd9004/2024_TSM_Full_Data_v2.1_FINAL.xlsx','currentSha256':hashlib.sha256(args.current.read_bytes()).hexdigest(),'previousSha256':hashlib.sha256(args.previous.read_bytes()).hexdigest()}
source.write_text(json.dumps(data,separators=(',',':'),ensure_ascii=False)+'\n')
print('Operational records matched:',sum(p['id'] in lookup for p in data['providers']))
