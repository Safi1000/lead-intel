// One-off: expand search_locations with a comprehensive Canada-wide municipality list.
// Bulk upsert via PostgREST (ignore-duplicates). Yield-aware search auto-skips dry ones.
import { readFileSync } from 'node:fs'
const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
const get = (k) => (env.match(new RegExp('^' + k + '=(.+)', 'm')) || [])[1].trim().replace(/^["']|["']$/g, '')
const SUPA = get('SUPABASE_URL'), KEY = get('SUPABASE_SERVICE_ROLE_KEY')

const BY_PROV = {
  ON: ['Toronto','Ottawa','Mississauga','Brampton','Hamilton','London','Markham','Vaughan','Kitchener','Windsor','Richmond Hill','Oakville','Burlington','Greater Sudbury','Sudbury','Oshawa','Barrie','St. Catharines','Guelph','Cambridge','Whitby','Ajax','Waterloo','Thunder Bay','Milton','Niagara Falls','Kingston','Brantford','Pickering','Peterborough','Sault Ste. Marie','Sarnia','Newmarket','Aurora','Welland','North Bay','Belleville','Cornwall','Chatham','Clarington','Bowmanville','Halton Hills','Georgetown','Georgina','Whitchurch-Stouffville','Stouffville','Caledon','Bolton','Innisfil','Bradford','Orillia','Orangeville','Cobourg','Collingwood','Owen Sound','Woodstock','Stratford','Timmins','Brockville','Leamington','Fort Erie','Grimsby','Lincoln','Midland','Wasaga Beach','Tillsonburg','Ingersoll','Kenora','Bracebridge','Huntsville','Petawawa','Pembroke','Kirkland Lake','Elliot Lake','Dryden','Hawkesbury','Kanata','Nepean','Amherstburg','Kingsville','LaSalle','Tecumseh','Essex','Simcoe','Port Colborne','Thorold','Pelham','Hanover','Greater Napanee','Napanee','Quinte West','Trenton','Port Hope','Kawartha Lakes','Lindsay','Renfrew','Arnprior','Carleton Place','Smiths Falls','Perth','Gananoque','Wallaceburg','Strathroy','St. Thomas','Aylmer','Port Elgin','Goderich','Listowel','New Hamburg','Elmira','Fergus','Elora','Acton','Alliston','Penetanguishene','Gravenhurst','Parry Sound','Espanola','Cochrane','Kapuskasing','Fort Frances','Sioux Lookout','Deep River','Rockland','Casselman','Embrun','Russell','Uxbridge','King City','Angus','Sturgeon Falls'],
  QC: ['Montreal','Quebec City','Laval','Gatineau','Longueuil','Sherbrooke','Levis','Trois-Rivieres','Terrebonne','Saint-Jean-sur-Richelieu','Repentigny','Brossard','Drummondville','Saint-Jerome','Granby','Blainville','Saint-Hyacinthe','Shawinigan','Dollard-des-Ormeaux','Rimouski','Chateauguay','Saint-Eustache','Victoriaville','Rouyn-Noranda','Salaberry-de-Valleyfield','Mascouche','Mirabel','Boucherville','Saint-Bruno-de-Montarville','Sorel-Tracy','Val-d\'Or','Vaudreuil-Dorion','Cote Saint-Luc','Alma','Sept-Iles','Magog','Boisbriand','Sainte-Julie','Saint-Constant','Beloeil','Chambly','Baie-Comeau','Thetford Mines','Saguenay','Joliette','La Prairie','Candiac','Varennes','Sainte-Therese','Pointe-Claire','Kirkland','Beaconsfield','Saint-Lambert','L\'Assomption','Montmagny','Saint-Georges','Sainte-Catherine','Deux-Montagnes','Rosemere','Lachute','Cowansville','Amos','Gaspe','Riviere-du-Loup','Matane','Dolbeau-Mistassini','Roberval','La Tuque','Mont-Laurier','Mont-Tremblant','Saint-Sauveur','Bromont','Coaticook','Farnham','Marieville','Lac-Megantic','Nicolet','Louiseville'],
  BC: ['Vancouver','Surrey','Burnaby','Richmond','Abbotsford','Coquitlam','Kelowna','Langley','Saanich','Delta','Kamloops','Nanaimo','Victoria','Chilliwack','Maple Ridge','Prince George','New Westminster','Port Coquitlam','North Vancouver','West Vancouver','Vernon','Courtenay','Penticton','Campbell River','Mission','Langford','Port Moody','White Rock','Pitt Meadows','Fort St. John','Cranbrook','Salmon Arm','Squamish','Powell River','Whistler','Parksville','Duncan','Comox','Sidney','Dawson Creek','Terrace','Prince Rupert','Williams Lake','Quesnel','Nelson','Trail','Castlegar','Revelstoke','Kimberley','Fernie','Sechelt','Gibsons','Qualicum Beach','Ladysmith','Summerland','Osoyoos','Oliver','Peachland','Merritt','Hope','Rossland','Golden','Creston','Grand Forks','Kitimat','Smithers','Fort Nelson','Ucluelet','Tofino','Sooke','Colwood','Esquimalt','Oak Bay','Lake Country','Enderby','Armstrong'],
  AB: ['Calgary','Edmonton','Red Deer','Lethbridge','St. Albert','Medicine Hat','Grande Prairie','Airdrie','Spruce Grove','Sherwood Park','Leduc','Fort Saskatchewan','Lloydminster','Camrose','Cochrane','Okotoks','Beaumont','Stony Plain','Sylvan Lake','Chestermere','Brooks','Cold Lake','Canmore','Wetaskiwin','Lacombe','Blackfalds','Morinville','Banff','Hinton','Whitecourt','Olds','High River','Strathmore','Taber','Innisfail','Drayton Valley','Ponoka','Rocky Mountain House','Edson','Slave Lake','Wainwright','Vegreville','Bonnyville','Peace River','Devon','Didsbury','Coaldale','Pincher Creek','Drumheller','Stettler','Vermilion','Barrhead','Athabasca','St. Paul'],
  SK: ['Saskatoon','Regina','Prince Albert','Moose Jaw','Swift Current','Yorkton','North Battleford','Estevan','Weyburn','Warman','Martensville','Melfort','Humboldt','Meadow Lake','Melville','Nipawin','Kindersley','Tisdale','Rosetown','Assiniboia','Battleford','Unity','Wynyard','Fort Qu\'Appelle','Esterhazy','Canora','Outlook','Watrous','Maple Creek'],
  MB: ['Winnipeg','Brandon','Steinbach','Winkler','Portage la Prairie','Thompson','Selkirk','Morden','Dauphin','The Pas','Flin Flon','Neepawa','Stonewall','Niverville','Altona','Carman','Virden','Beausejour','Swan River','Gimli','Killarney','Minnedosa','Roblin'],
  NS: ['Halifax','Dartmouth','Sydney','Truro','New Glasgow','Glace Bay','Kentville','Amherst','Bridgewater','Yarmouth','Antigonish','New Waterford','Sydney Mines','Wolfville','Stellarton','Pictou','Digby','Liverpool','Shelburne','Berwick','Middleton','Springhill','Port Hawkesbury','Lunenburg'],
  NB: ['Moncton','Saint John','Fredericton','Dieppe','Riverview','Miramichi','Edmundston','Bathurst','Campbellton','Oromocto','Sackville','Sussex','Woodstock','Grand Falls','Shediac','Tracadie','Caraquet','Dalhousie','St. Stephen','Rothesay','Quispamsis'],
  NL: ['St. John\'s','Mount Pearl','Conception Bay South','Paradise','Corner Brook','Grand Falls-Windsor','Gander','Happy Valley-Goose Bay','Torbay','Labrador City','Stephenville','Clarenville','Bay Roberts','Marystown','Carbonear'],
  PE: ['Charlottetown','Summerside','Stratford','Cornwall','Montague'],
  YT: ['Whitehorse','Dawson City'],
  NT: ['Yellowknife','Hay River','Inuvik','Fort Smith'],
  NU: ['Iqaluit'],
}

const rows = []
for (const [prov, cities] of Object.entries(BY_PROV)) {
  for (const c of cities) rows.push({ location: `${c}, ${prov}, Canada`, country: 'CA', active: true })
}
// de-dupe within our own list
const seen = new Set(), unique = rows.filter((r) => !seen.has(r.location) && seen.add(r.location))
console.log(`prepared ${unique.length} locations`)

const res = await fetch(`${SUPA}/rest/v1/search_locations`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
  body: JSON.stringify(unique),
})
console.log('insert status:', res.status, res.ok ? 'OK' : await res.text())

const count = await (await fetch(`${SUPA}/rest/v1/search_locations?select=location&active=is.true`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact' } })).headers
const total = await fetch(`${SUPA}/rest/v1/search_locations?active=is.true`, { method: 'HEAD', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: 'count=exact', Range: '0-0' } })
console.log('active locations now:', total.headers.get('content-range'))
