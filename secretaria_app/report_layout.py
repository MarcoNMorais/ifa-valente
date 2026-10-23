"""Relatórios de impressão independentes da tela, com paginação compacta."""
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode
import html

MONTHS=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro']
def esc(v): return html.escape(str(v if v is not None else ''))
def money(c): return 'R$ '+f'{c/100:,.2f}'.replace(',','X').replace('.',',').replace('X','.')
def number(n): return f'{n:,.3f}'.rstrip('0').rstrip('.').replace(',','X').replace('.',',').replace('X','.')
def day(s): return '/'.join(s.split('-')[::-1])
def month(s): return MONTHS[int(s[5:7])-1]+' de '+s[:4]
def chunks(rows,size): return [rows[i:i+size] for i in range(0,len(rows),size)]
def table(headers,rows):
    return '<table class="data"><thead><tr>'+''.join('<th>'+esc(h)+'</th>' for h in headers)+'</tr></thead><tbody>'+''.join('<tr>'+''.join('<td>'+esc(c)+'</td>' for c in row)+'</tr>' for row in rows)+'</tbody></table>'
def metrics(entries):
    return '<div class="metrics">'+''.join(f'<div><span>{esc(k)}</span><strong>{esc(v)}</strong><small>{esc(note)}</small></div>' for k,v,note in entries)+'</div>'
def section(title,content): return '<section><h2>'+esc(title)+'</h2>'+content+'</section>'
def graph(months,key):
    maxval=max([m[key] for m in months]+[1]);parts=[]
    for i,m in enumerate(months):
        x=14+i*57;height=max(1,m[key]/maxval*102);y=134-height
        val=money(m[key]) if key=='cents' else number(m[key])
        parts.append(f'<rect x="{x+9}" y="{y}" width="30" height="{height}" rx="3" fill="{"#145aa3" if i==11 else "#9ebddc"}"/><text x="{x+24}" y="{y-8}" text-anchor="middle">{esc(val)}</text><text x="{x+24}" y="152" text-anchor="middle">{m["month"][5:]}/{m["month"][2:4]}</text>')
    return '<svg class="evolution" viewBox="0 0 700 165" role="img" aria-label="Evolução de doze meses">'+''.join(parts)+'</svg>'

def render(data,q):
    pages=[];detailed=q.get('details')=='1';patient=data.get('patient');rows=[]
    if patient:
        title='Relatório individual';period=data['period'];from_date=period.get('from');to_date=period.get('to')
        subtitle=(day(from_date) if from_date else 'Início do histórico')+' a '+(day(to_date) if to_date else 'data mais recente') if from_date or to_date else 'Todo o histórico'
        groups={}
        for v in data['visits']:
            key=v['date'][:7];g=groups.setdefault(key,{'visits':0,'cents':0,'items':{}});g['visits']+=1;g['cents']+=v['cents']
            for it in v['items']:
                k=(it['product'],it['unit']);g['items'][k]=g['items'].get(k,0)+it['quantity']
                rows.append({'date':v['date'],'patient':patient['name'],'product':it['product'],'unit':it['unit'],'quantity':it['quantity'],'supplier':it['supplier'],'cents':it['cents']})
        summary_rows=[[month(m),' · '.join(f'{n}: {number(qty)} {unit}' for (n,unit),qty in g['items'].items()),g['visits'],money(g['cents'])] for m,g in groups.items()]
        intro='<div class="patient"><h2>'+esc(patient['name'])+'</h2>'+('<p>CPF: '+esc(patient['cpf'])+'</p>' if patient.get('cpf') else '')+'</div>'
        intro+=metrics([('Total no período',money(sum(v['cents'] for v in data['visits'])),'Itens cedidos'),('Atendimentos',len(data['visits']),'No período selecionado'),('Meses com registros',len(groups),'Histórico consolidado')])
        batches=chunks(summary_rows,4) or [[]]
        for i,batch in enumerate(batches):
            pages.append((intro if i==0 else '')+section('Resumo mês a mês',table(['Mês','Itens cedidos','Atendimentos','Total'],batch) if batch else '<p class="empty">Nenhum atendimento no período escolhido.</p>'))
    else:
        daily=bool(data.get('day'));selected=bool(q.get('product'));s=data['summary'];rows=data['rows']
        title='Relatório diário' if daily else 'Relatório por item' if selected else 'Gastos mensais'
        subtitle=day(data['day']) if daily else month(data['month'])
        if data.get('product_label'): subtitle+=' · '+data['product_label']
        if data.get('supplier_label'): subtitle+=' · '+data['supplier_label']
        comparison='dia anterior' if daily else 'mês anterior'
        change='Sem base no '+comparison if s['variation'] is None else f'{s["variation"]:+.1f}% em relação ao {comparison}'.replace('.',',')
        intro=metrics([('Valor no dia' if daily else 'Valor no mês',money(s['cents']),change),('Pessoas diferentes',s['people'],'No período selecionado'),('Atendimentos',s['visits'],'No período selecionado')])
        if not daily: intro+=section('Evolução nos últimos 12 meses',graph(data['months'],'quantity' if selected else 'cents')+'<p class="note">'+('Quantidade cedida do item selecionado.' if selected else 'Valor total cedido por mês.')+'</p>')
        suppliers=defaultdict(lambda:{'cents':0,'patients':set()})
        for r in rows:
            g=suppliers[r['supplier'] or 'Não informado'];g['cents']+=r['cents'];g['patients'].add(r['patient_id'])
        supplier_rows=[[name,len(g['patients']),money(g['cents'])] for name,g in sorted(suppliers.items(),key=lambda p:-p[1]['cents'])]
        intro+=section('Gastos por fornecedor',table(['Fornecedor','Pessoas diferentes','Total'],supplier_rows[:8]) if rows else '<p class="empty">Nenhum registro para os filtros selecionados.</p>')
        pages.append(intro)
        for batch in chunks(supplier_rows[8:],24): pages.append(section('Gastos por fornecedor · continuação',table(['Fornecedor','Pessoas diferentes','Total'],batch)))
        product_rows=[[p['name'],number(p['quantity'])+' '+p['unit'],p['people'],money(p['cents'])] for p in data['products']]
        for batch in chunks(product_rows,28):
            content=section('Itens cedidos no dia' if daily else 'Itens cedidos no mês',table(['Item','Quantidade','Pessoas','Total'],batch))
            if selected and not daily:
                p=data['products'][0];change='Sem base nos seis meses anteriores.' if p['growth'] is None else f'Variação de {number(p["growth"])}% em relação à média dos seis meses anteriores.'
                content+='<p class="note">Média de quantidade: '+number(p['average'])+'. '+esc(change)+' Meses sem lançamento entram com zero.</p>'
                content+=section('Valores mês a mês',table(['Mês','Quantidade','Pessoas','Valor'],[[month(m['month']),number(m['quantity']),m['people'],money(m['cents'])] for m in data['months']]))
            pages.append(content)
    if detailed:
        details_rows=[[day(r['date']),r['patient'],r['product'],number(r['quantity'])+' '+r['unit'],r['supplier'] or '—',money(r['cents'])] for r in rows]
        for batch in chunks(details_rows,16): pages.append(section('Lançamentos detalhados',table(['Data','Paciente','Item','Quantidade','Fornecedor','Valor'],batch)))
    stamp=datetime.now(timezone(timedelta(hours=-3))).strftime('%d/%m/%Y às %H:%M')
    sheet_html=[]
    for i,content in enumerate(pages):
        sheet_html.append(f'<article class="report-sheet"><img class="watermark" src="/secretaria/static/brasao.png" alt=""><div class="page-content"><header><img class="brand-logo" src="/secretaria/static/logo.png" alt="Prefeitura de Valente — Secretaria da Saúde"><div class="brand-label">ATENDIMENTO<br><strong>ESPECIAL</strong></div></header><div class="report-heading"><span>SECRETARIA MUNICIPAL DE SAÚDE</span><h1>{esc(title)}</h1><p>{esc(subtitle)}</p></div>{content}<footer><span>Saúde Valente · Emitido em {stamp}</span><span>Página {i+1} de {len(pages)}</span></footer></div></article>')
    inputs=''.join(f'<input type="hidden" name="{esc(k)}" value="{esc(v)}">' for k,v in q.items() if k in ('patient','from','to','day','month','product','supplier'))
    toggle=f'<form method="get" action="/secretaria/report-print">{inputs}<label><input type="checkbox" name="details" value="1" {"checked" if detailed else ""}> Incluir lançamentos detalhados</label><button type="submit" class="secondary">Atualizar prévia</button></form>'
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(title)+' | Saúde Valente</title><link rel="stylesheet" href="/secretaria/static/report-print.css"></head><body><div class="print-toolbar"><div><button id="print">Imprimir / salvar PDF</button><small>A4 retrato · desative os cabeçalhos e rodapés do navegador</small></div>'+toggle+'</div><main>'+''.join(sheet_html)+'</main><script src="/secretaria/static/print.js"></script></body></html>'
