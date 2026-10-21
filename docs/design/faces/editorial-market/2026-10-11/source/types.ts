export type Locale = 'bg_BG'|'en_US'|'de_DE'|'es_ES'|'fr_FR'|'it_IT'|'ro_RO'|'ru_RU'|'sr_RS'|'el_GR'|'tr_TR';
export type ViewText = { text: string; lang: Locale };
export type ViewImage = { id:string; src:string; variant:'thumb'|'card'|'full'; width:number; variants:{src:string;width:number}[]; sourceWidth:number; sourceHeight:number; focal:{x:number;y:number}|null; objectPosition:string; alt:ViewText|null };
export type ViewAllergen = { code:string; number:number; label:ViewText };
export type ViewDietary = { code:string; label:ViewText };
export type ViewTag = { id:string; label:ViewText };
export type ViewBadge = { kind:'new'|'dietary'|'tag'; code?:string; id?:string; label:ViewText };
export type ViewExtraField = { key:string; type:string; label:ViewText; text:string; lang:Locale|null };
export type ViewModifierGroup = { id:string; name:ViewText; min:number; max:number; required:boolean; options:{id:string;name:ViewText;delta:{minor:number;currency:'EUR';text:string}|null}[] };
export type ViewItem = { id:string; name:ViewText; price:{minor:number;currency:'EUR';amount:string;from:boolean;text:string}|null; state:{code:'available'|'sold_out'|'scheduled'|'unavailable';label:ViewText|null;schedule:{opensAt:string;weekday:number|null;text:ViewText}|null}; allergens:ViewAllergen[]; description:(ViewText&{truncatable:boolean})|null; image:ViewImage|null; noImage:boolean; badges:ViewBadge[]; portion:{value:number;unit:string;text:string}|null; dietary:ViewDietary[]; tags:ViewTag[]; extraFields:ViewExtraField[]; modifierGroups:ViewModifierGroup[]; order:{controls:boolean;askWaiter:ViewText|null} };
export type ViewSection = { id:string; title:ViewText; description:ViewText|null; image:ViewImage|null; hints:{color:string|null;onColor:string|null;icon:string|null}; sections:ViewSection[]; items:ViewItem[] };
/** Eight platform-owned roles per mode. Preset IDs are not part of the face contract. */
export type SemanticColors = { background:string;surface:string;accent:string;onAccent:string;text:string;muted:string;accentText:string;border:string };
export type ViewModel = { locale:Locale;currency:'EUR';channel:'qr'|'kiosk'|'print'|'tv';menu:{id:string;title:ViewText|null;intro:ViewText|null;schedule:{opensAt:string;weekday:number|null;text:ViewText}|null};sections:ViewSection[];allergenLegend:ViewAllergen[];filters:{tags:ViewTag[];dietary:ViewDietary[]};ordering:{enabled:boolean};theme:{palette:Record<string,string>;colors:SemanticColors;colorsDark:SemanticColors;font:string;radius:number;shadow:number;logo:ViewImage|null} };
export type FaceProps = { view:ViewModel;assetBase?:string;languages?:Locale[];onLanguageChange?:(locale:Locale)=>void;tableLabel?:string|null;fontStacks?:Record<string,string>;scheme?:'auto'|'light'|'dark';ordering?:import('./ordering/ui').OrderingConfig|null };
