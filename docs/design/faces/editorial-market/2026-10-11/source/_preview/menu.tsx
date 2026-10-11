import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { EditorialMarketFace } from '@/features/restro-face/face';
import type { Locale, ViewModel } from '@/features/restro-face/types';
import type { OrderingConfig } from '@/features/restro-face/ordering/ui';
import { demoTab, formatEur, withDemoChoices } from '@/features/restro-face/ordering/demo';
import menuEn from '@/features/restro-face/fixtures/menu-demo.en.json';
import menuBg from '@/features/restro-face/fixtures/menu-demo.bg.json';
import { resolveExampleTheme, themeExamples } from '@/features/restro-face/fixtures/themes/examples';

const menuHead=()=>({meta:[{title:'Restaurant Menu — Restro Face Preview'},{name:'description',content:'An editorial, theme-aware restaurant menu with table ordering, live tab, waiter calls and payment.'},{property:'og:title',content:'Restaurant Menu — Restro Face Preview'},{property:'og:description',content:'An editorial, theme-aware restaurant menu with table ordering, live tab, waiter calls and payment.'},{property:'og:type',content:'website'},{name:'twitter:card',content:'summary_large_image'}]});
export const Route=createFileRoute('/menu')({head:menuHead,component:MenuPreview});

export function MenuPreview(){
  // Agent review shell only: production replaces fixtures with platform JSON,
  // supplies scheme/fontStacks/context, and binds actions to platform callbacks.
  const [locale,setLocale]=useState<Locale>('bg_BG');
  const [preset,setPreset]=useState('botanical');
  const [open,setOpen]=useState(false);
  const [scheme,setScheme]=useState<'light'|'dark'>('light');
  const base=useMemo(()=>withDemoChoices((locale==='bg_BG'?menuBg:menuEn) as ViewModel),[locale]);
  const view=resolveExampleTheme(base,preset);
  const ordering=useMemo<OrderingConfig>(()=>({formatMoney:formatEur(locale),tab:demoTab(locale),vatRate:20,venueName:'RESTRO',tableLabel:'12',onPay:()=>new Promise(r=>setTimeout(()=>r(true),1400))}),[locale]);
  return <>
    <EditorialMarketFace view={view} assetBase="/menu-assets" languages={['bg_BG','en_US']} onLanguageChange={setLocale} tableLabel="12" scheme={scheme} ordering={ordering}/>
    <button type="button" aria-label="Preview theme" aria-expanded={open} onClick={()=>setOpen(!open)} className="fixed left-3 bottom-4 z-30 h-10 w-10 rounded-full border border-border bg-background/95 text-xs font-bold text-foreground shadow-lg">Aa</button>
    <div role="group" aria-label="Preview theme" className={`fixed left-3 bottom-16 z-30 ${open?"flex":"hidden"} flex-col items-center gap-1 rounded-2xl border border-border bg-background/95 p-1 text-xs text-foreground shadow-lg backdrop-blur`}>
      <label className="sr-only" htmlFor="rm-preset">Theme</label>
      <select id="rm-preset" value={preset} onChange={e=>setPreset(e.target.value)} className="h-9 w-24 rounded-full bg-transparent px-2 font-semibold">
        {Object.entries(themeExamples).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
      </select>
      <button type="button" onClick={()=>setScheme(scheme==='light'?'dark':'light')} className="h-9 w-24 rounded-full bg-foreground px-3 font-semibold text-background">{scheme==='light'?'Light':'Dark'}</button>
    </div>
  </>;
}
