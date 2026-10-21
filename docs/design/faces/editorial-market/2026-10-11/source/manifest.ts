export const editorialMarketManifest = {
  face:'editorial-market', version:'1.0.0', channels:['qr'],
  slots:{'item.name':'required','item.price':'required','item.allergens':'required','item.state':'required','item.description':{optional:true,lines:3,overflow:'expand'},'item.image':{optional:true,variant:'card',aspect:'4:3'},'item.badges':'optional','item.portion':'optional','item.dietary':'optional','item.tags':'optional','item.extra_fields':'optional','item.modifiers':'optional'},
  allergen_mode:'inline_codes', no_image_layout:'text_only', ordering:'optional', paging:null,
  tokens:['color.background','color.surface','color.accent','color.on_accent','color.text','color.muted','color.accent_text','color.border','font','radius','shadow','logo']
} as const;
