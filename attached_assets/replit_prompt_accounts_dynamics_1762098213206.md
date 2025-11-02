# Replit Task: Normalize Accounts Export to Dynamics-Aligned Template

**Goal**  
Transform the Excel export (`Active Accounts 11-2-2025 9-04-12 AM.xlsx` sheet `Active Accounts`) into the header order in `accounts-template.dynamics.csv` by applying
`dynamics_mapping_config.json` to rename/map fields, generate a stable internal `Record ID`, validate, dedupe,
and write `/mnt/data/accounts_aligned.csv`.

**What to Build**
1) Read `/mnt/data/dynamics_mapping_config.json`.
2) Load the Excel source using `source_file` and `sheet_name`.
3) Rename columns using `column_mapping`.
4) Ensure every column in `target_template` exists. Add missing as empty strings.
5) Internal `Record ID`:
   - If any of `external_id_fields` is present and non-empty, you may reuse it (normalized) as `Record ID`.
   - Otherwise generate using `internal_id_pattern` with tokens `{{YYYY}}`, `{{MM}}`, and a zero-padded counter like `{{00001}}`.
6) Validate per `validation_rules` (phone, email, url, state/province length, postal length). Flag issues as `Import Status='Error'` and explain in `Import Notes`.
7) Dedupe using `dedupe_rules.primary_key` (and fuzzy threshold if rapidfuzz available). Keep the first occurrence; annotate drops in `Import Notes`.
8) Set governance defaults: `Source System='Dynamics Export'`, fill `Source Record ID` from the best available source ID, `Import Status='OK'` unless errors.
9) Reorder columns to **exactly** match `accounts-template.dynamics.csv` and write `/mnt/data/accounts_aligned.csv`.

**Starter Code**
```python
import json, re, datetime as dt
import pandas as pd

cfg = json.load(open('/mnt/data/dynamics_mapping_config.json','r',encoding='utf-8'))
df = pd.read_excel(f"/mnt/data/{cfg['source_file']}", sheet_name=cfg['sheet_name'], dtype=str).fillna('')

# Rename
df = df.rename(columns=cfg['column_mapping'])

# Ensure target columns
template_cols = list(pd.read_csv(f"/mnt/data/{cfg['target_template']}", nrows=0).columns)
for col in template_cols:
    if col not in df.columns:
        df[col] = ''

# Internal Record ID
def make_id(i, pattern):
    now = dt.datetime.now()
    out = pattern.replace('{{YYYY}}', f"{now.year:04d}").replace('{{MM}}', f"{now.month:02d}")
    m = re.search(r'\{\{(0+1)\}\}', out)
    if m:
        width = len(m.group(1)) - 1
        out = re.sub(r'\{\{0+1\}\}', str(i+1).zfill(width), out)
    return out

ext_opts = [c for c in cfg['id_rules']['external_id_fields'] if c in df.columns]
if ext_opts:
    df['Record ID'] = df[ext_opts].bfill(axis=1).iloc[:,0].astype(str).str.replace(r'\W+','', regex=True)
else:
    df['Record ID'] = [make_id(i, cfg['id_rules']['internal_id_pattern']) for i in range(len(df))]

# Governance defaults
for g in cfg['governance_fields']:
    if g not in df.columns:
        df[g] = ''
df['Source System'] = df['Source System'].replace('', 'Dynamics Export')
if 'Source Record ID' in df.columns and ext_opts:
    df['Source Record ID'] = df['Source Record ID'].replace('', df[ext_opts[0]])

# Reorder/save
df = df[template_cols]
df.to_csv('/mnt/data/accounts_aligned.csv', index=False)
print('Aligned rows:', len(df))
```
