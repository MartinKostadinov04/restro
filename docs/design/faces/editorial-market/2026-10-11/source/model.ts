import type { CSSProperties } from 'react';
import type { Locale, SemanticColors, ViewImage, ViewText, ViewModel } from './types';
export const bcp47=(locale:Locale)=>locale.replace('_','-');
export const textLang=(value:ViewText,page:Locale)=>value.lang===page?undefined:bcp47(value.lang);
export const assetUrl=(base:string,path:string)=>`${base.replace(/\/$/,'')}${path}`;
export function themeVariables(view:ViewModel,fontStacks?:Record<string,string>):CSSProperties{
 const vars:Record<string,string|number>={'--rm-font':fontStacks?.[view.theme.font]??`${view.theme.font}, system-ui, sans-serif`,'--rm-radius':`${view.theme.radius}px`,'--rm-shadow':String(view.theme.shadow)};
 const add=(prefix:string,c:SemanticColors)=>{for(const [k,v] of Object.entries(c))vars[`--rm-${prefix}-${k}`]=v;}; add('l',view.theme.colors);add('d',view.theme.colorsDark);
 return vars as CSSProperties;
}
export function imageProps(image:ViewImage,base:string,sizes:string){return{src:assetUrl(base,image.src),srcSet:image.variants.map(v=>`${assetUrl(base,v.src)} ${v.width}w`).join(', '),sizes,width:image.sourceWidth,height:image.sourceHeight,style:{objectPosition:image.objectPosition},alt:image.alt?.text??''};}
