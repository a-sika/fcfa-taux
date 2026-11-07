// Générateur du site "Taux FCFA".
// Usage : node build.mjs   (produit le dossier dist/)
// Aucune dépendance : Node 20+ suffit. Tourne chaque jour dans GitHub Actions.
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const DATA = join(ROOT, 'data');
const PEG = 655.957; // parité fixe légale : 1 EUR = 655,957 FCFA (XOF et XAF)

const config = JSON.parse(await readFile(join(ROOT, 'config.json'), 'utf8'));
const BASE_URL = (process.env.SITE_URL || config.baseUrl || '').replace(/\/+$/, '');

/* ------------------------------------------------------------------ */
/* 1. Récupération des taux (avec secours et cache : ne casse jamais)  */
/* ------------------------------------------------------------------ */
async function getJson(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'fcfa-taux-site' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fetchRates() {
  // Source 1 : ExchangeRate-API (gratuit, sans clé, contient XOF, MAD, NGN, GHS...)
  try {
    const j = await getJson('https://open.er-api.com/v6/latest/EUR');
    if (j.result === 'success' && j.rates?.USD) {
      return { rates: j.rates, date: new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10), source: 'ExchangeRate-API' };
    }
  } catch (e) { console.warn('Source 1 indisponible :', e.message); }
  // Source 2 : Frankfurter (BCE) — moins de devises, mais fiable
  try {
    const j = await getJson('https://api.frankfurter.dev/v1/latest?base=EUR');
    if (j.rates?.USD) return { rates: { EUR: 1, ...j.rates }, date: j.date, source: 'Banque centrale européenne' };
  } catch (e) { console.warn('Source 2 indisponible :', e.message); }
  return null;
}

await mkdir(DATA, { recursive: true });
const ratesFile = join(DATA, 'rates.json');
const historyFile = join(DATA, 'history.json');
let snapshot = null;
const fresh = await fetchRates();
if (fresh) {
  snapshot = fresh;
  await writeFile(ratesFile, JSON.stringify(fresh, null, 1));
} else if (existsSync(ratesFile)) {
  console.warn('Aucune source joignable : utilisation du dernier cache.');
  snapshot = JSON.parse(await readFile(ratesFile, 'utf8'));
} else {
  console.error('Aucun taux disponible et aucun cache.');
  process.exit(1);
}

// Les FCFA sont arrimés à l'euro : on force la parité exacte.
const perEur = { ...snapshot.rates, EUR: 1, XOF: PEG, XAF: PEG };
const DATE = snapshot.date;

// Historique (un relevé par jour, conservé 400 jours)
let history = existsSync(historyFile) ? JSON.parse(await readFile(historyFile, 'utf8')) : {};
const codes = config.currencies.map(([c]) => c).filter((c) => perEur[c]);
history[DATE] = Object.fromEntries(codes.map((c) => [c, perEur[c]]));
const keys = Object.keys(history).sort();
for (const k of keys.slice(0, Math.max(0, keys.length - 400))) delete history[k];
await writeFile(historyFile, JSON.stringify(history));
const days = Object.keys(history).sort();

const currencies = config.currencies.filter(([c]) => perEur[c]).map(([code, name]) => ({ code, name }));
// 1 unité de C = combien de FCFA ?
const toFcfa = (code, hist = perEur) => PEG / hist[code];

/* ------------------------------------------------------------------ */
/* 2. Utilitaires de mise en forme                                      */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nf = (max) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: max, minimumFractionDigits: 0 });
const fmt = (n) => {
  const a = Math.abs(n);
  const d = a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : 6;
  return nf(d).format(n);
};
const fmtInt = (n) => nf(0).format(n);
const dateFr = (iso) => new Date(iso + 'T12:00:00Z').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const nameOf = (c) => currencies.find((x) => x.code === c).name;

function change(code, nDays) {
  // variation en % de la valeur de 1 unité de C en FCFA, par rapport à il y a nDays jours
  const target = new Date(DATE + 'T12:00:00Z');
  target.setUTCDate(target.getUTCDate() - nDays);
  const tIso = target.toISOString().slice(0, 10);
  const past = days.filter((d) => d <= tIso && history[d][code]).pop();
  if (!past) return null;
  const then = toFcfa(code, history[past]);
  const now = toFcfa(code);
  return { pct: ((now - then) / then) * 100, since: past };
}
const pct = (v) => (v == null ? '—' : (v.pct >= 0 ? '+' : '') + nf(2).format(v.pct) + ' %');

/* ------------------------------------------------------------------ */
/* 3. Gabarit HTML                                                      */
/* ------------------------------------------------------------------ */
const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--tx:#14181f;--mut:#5b6573;--ac:#e8590c;--ac2:#087f5b;--bd:#e1e5ea}
@media(prefers-color-scheme:dark){:root{--bg:#10131a;--card:#181c25;--tx:#eef1f5;--mut:#9aa5b4;--ac:#ff8a4c;--ac2:#3ddc97;--bd:#2a303c}}
*{box-sizing:border-box}body{margin:0;font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--tx)}
a{color:var(--ac)}header{background:var(--card);border-bottom:1px solid var(--bd)}
.w{max-width:880px;margin:0 auto;padding:0 16px}header .w{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px}
.logo{font-weight:800;font-size:1.2rem;text-decoration:none;color:var(--tx)}.logo b{color:var(--ac)}
nav a{margin-left:14px;text-decoration:none;font-size:.92rem}
main{padding:20px 0 40px}h1{font-size:1.65rem;line-height:1.25;margin:.2em 0 .4em}h2{font-size:1.2rem;margin:1.6em 0 .5em}
.card{background:var(--card);border:1px solid var(--bd);border-radius:14px;padding:16px;margin:14px 0}
.big{font-size:1.9rem;font-weight:800;color:var(--ac2)}.mut{color:var(--mut);font-size:.9rem}
.conv{display:grid;grid-template-columns:1fr auto 1fr;gap:8px;align-items:end}
.conv label{display:block;font-size:.8rem;color:var(--mut);margin-bottom:3px}
.conv input,.conv select{width:100%;padding:11px;border:1px solid var(--bd);border-radius:10px;background:var(--bg);color:var(--tx);font-size:1rem}
.conv button{padding:11px 13px;border:0;border-radius:10px;background:var(--ac);color:#fff;font-size:1.1rem;cursor:pointer}
.res{margin-top:12px;font-size:1.25rem;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:.95rem}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid var(--bd)}
th{color:var(--mut);font-weight:600;font-size:.82rem}td.r,th.r{text-align:right}
.up{color:var(--ac2)}.dn{color:#e03131}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chips a{padding:6px 11px;border:1px solid var(--bd);border-radius:20px;text-decoration:none;font-size:.9rem;background:var(--card)}
details{border-bottom:1px solid var(--bd);padding:9px 0}summary{cursor:pointer;font-weight:600}
.aff{border-left:4px solid var(--ac)}.cta{display:inline-block;margin-top:8px;padding:9px 16px;border-radius:10px;background:var(--ac);color:#fff;text-decoration:none;font-weight:700}footer{border-top:1px solid var(--bd);padding:20px 0;color:var(--mut);font-size:.85rem}
@media(max-width:560px){.conv{grid-template-columns:1fr}.conv button{width:100%}h1{font-size:1.4rem}}
`;

const CLIENT_JS = `
(function(){
var R=window.__R,P=${PEG};
function perEurFor(c){return c==='XOF'?P:R[c]}
function conv(a,f,t){return a/perEurFor(f)*perEurFor(t)}
function fmt(n){var a=Math.abs(n),d=a>=100?2:a>=1?3:a>=0.01?4:6;return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:d}).format(n)}
var q=function(i){return document.getElementById(i)};
var a=q('amt'),f=q('from'),t=q('to'),o=q('out');
if(!a)return;
function run(){var v=parseFloat(String(a.value).replace(/\\s/g,'').replace(',','.'));
 if(isNaN(v)){o.textContent='';return}
 o.textContent=fmt(v)+' '+f.value+' = '+fmt(conv(v,f.value,t.value))+' '+t.value}
q('swap').onclick=function(){var x=f.value;f.value=t.value;t.value=x;run()};
[a,f,t].forEach(function(e){e.addEventListener('input',run);e.addEventListener('change',run)});
run();
})();
`;

const homeHref = (depth) => (depth === 0 ? './' : '../');

function layout({ depth, title, description, canonicalPath, body, jsonld }) {
  const h = homeHref(depth);
  const canonical = BASE_URL ? `<link rel="canonical" href="${BASE_URL}/${canonicalPath}">` : '';
  const ads = config.adsenseClient
    ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(config.adsenseClient)}" crossorigin="anonymous"></script>`
    : '';
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical}
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:type" content="website"><meta property="og:locale" content="fr_FR">
<link rel="stylesheet" href="${h}style.css">
${ads}
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
</head><body>
<header><div class="w"><a class="logo" href="${h}">Taux <b>FCFA</b></a>
<nav><a href="${h}">Accueil</a><a href="${h}a-propos/">À propos</a></nav></div></header>
<main><div class="w">
${body}
</div></main>
<footer><div class="w">
<p>Taux indicatifs mis à jour le ${dateFr(DATE)} · Source : ${esc(snapshot.source)} ${snapshot.source === 'ExchangeRate-API' ? '(<a href="https://www.exchangerate-api.com" rel="nofollow noopener">Rates By Exchange Rate API</a>)' : ''}.
Ce ne sont pas les taux appliqués par les banques ou les bureaux de change.</p>
<p><a href="${h}a-propos/">À propos</a> · <a href="${h}mentions-legales/">Mentions légales</a> · <a href="${h}confidentialite/">Confidentialité</a></p>
</div></footer>
</body></html>`;
}

function converterWidget(fromCode, toCode, amount) {
  const opts = (sel) => ['XOF', ...currencies.map((c) => c.code)]
    .map((c) => `<option value="${c}"${c === sel ? ' selected' : ''}>${c}${c === 'XOF' ? ' — Franc CFA (FCFA)' : ' — ' + esc(nameOf(c))}</option>`).join('');
  return `<div class="card"><div class="conv">
<div><label for="amt">Montant</label><input id="amt" inputmode="decimal" value="${amount}"></div>
<div></div><div></div>
<div><label for="from">De</label><select id="from">${opts(fromCode)}</select></div>
<button id="swap" type="button" aria-label="Inverser" title="Inverser">⇄</button>
<div><label for="to">Vers</label><select id="to">${opts(toCode)}</select></div>
</div><div class="res" id="out" aria-live="polite"></div></div>`;
}

function affiliateBlock() {
  // Les entrées sans "url" sont ignorées : il suffit de coller le lien pour activer le bloc.
  const list = (config.affiliates || []).filter((a) => a && /^https:\/\//.test(a.url || ''));
  if (!list.length) return '';
  return list.map((a) => `<div class="card aff"><strong>${esc(a.title)}</strong><br>${esc(a.text)}<br>
<a class="cta" href="${esc(a.url)}" rel="sponsored nofollow noopener" target="_blank">${esc(a.cta || 'En savoir plus')} →</a>
<div class="mut" style="margin-top:6px">Lien partenaire : ce site peut percevoir une commission, sans frais supplémentaires pour vous.</div></div>`).join('');
}

const scriptTag = () => `<script>window.__R=${JSON.stringify(Object.fromEntries(['EUR', ...codes.filter((c) => c !== 'EUR')].map((c) => [c, perEur[c]])))};</script><script>${CLIENT_JS}</script>`;

/* ------------------------------------------------------------------ */
/* 4. Pages                                                             */
/* ------------------------------------------------------------------ */
const pages = []; // { path, html, priority }
const slugToFcfa = (c, n, def) => (n === def ? `${c.toLowerCase()}-en-fcfa` : `${n}-${c.toLowerCase()}-en-fcfa`);
const slugFromFcfa = (c, n, def) => (n === def ? `fcfa-en-${c.toLowerCase()}` : `${n}-fcfa-en-${c.toLowerCase()}`);

function pairPage(code, direction, amount) {
  const toF = direction === 'toFcfa';
  const def = toF ? 1 : 1000;
  const amounts = toF ? config.amountsToFcfa : config.amountsFromFcfa;
  const name = nameOf(code);
  const rateUnit = toF ? toFcfa(code) : (1 / toFcfa(code)); // taux pour 1 unité source
  const result = amount * rateUnit;
  const srcCode = toF ? code : 'XOF';
  const dstCode = toF ? 'XOF' : code;
  const srcLabel = toF ? code : 'FCFA';
  const dstLabel = toF ? 'FCFA' : code;
  const slug = toF ? slugToFcfa(code, amount, def) : slugFromFcfa(code, amount, def);
  const q = `${fmtInt(amount)} ${srcLabel} en ${dstLabel}`;
  const ch7 = change(code, 7);
  const ch30 = change(code, 30);

  const title = `${q} : conversion ${srcLabel} → ${dstLabel} (${dateFr(DATE)})`;
  const desc = `${fmtInt(amount)} ${srcLabel} = ${fmt(result)} ${dstLabel} au taux du ${dateFr(DATE)}. Convertisseur ${name} / Franc CFA (XOF), tableau de conversion et évolution du cours.`;

  const table = amounts.map((n) => {
    const href = (toF ? slugToFcfa(code, n, def) : slugFromFcfa(code, n, def));
    return `<tr><td><a href="../${href}/">${fmtInt(n)} ${srcLabel}</a></td><td class="r"><strong>${fmt(n * rateUnit)} ${dstLabel}</strong></td></tr>`;
  }).join('');

  const histRows = days.slice(-30).reverse().filter((d) => history[d][code]).map((d) => {
    const v = toFcfa(code, history[d]);
    return `<tr><td>${dateFr(d)}</td><td class="r">${fmt(toF ? v : 1 / v)} ${dstLabel}</td></tr>`;
  }).join('');
  const histBlock = days.length >= 2 ? `<h2>Évolution récente</h2><div class="card"><table><tr><th>Date</th><th class="r">1 ${srcLabel} en ${dstLabel}</th></tr>${histRows}</table></div>` : '';

  const trend = (ch7 || ch30)
    ? `<p class="mut">Variation de 1 ${code} en FCFA : <strong class="${ch7 && ch7.pct >= 0 ? 'up' : 'dn'}">${pct(ch7)}</strong> sur 7 jours · <strong class="${ch30 && ch30.pct >= 0 ? 'up' : 'dn'}">${pct(ch30)}</strong> sur 30 jours.</p>` : '';

  const other = currencies.filter((c) => c.code !== code).slice(0, 12)
    .map((c) => `<a href="../${toF ? slugToFcfa(c.code, 1, 1) : slugFromFcfa(c.code, 1000, 1000)}/">${toF ? c.code + ' → FCFA' : 'FCFA → ' + c.code}</a>`).join('');
  const reverse = toF ? `<a href="../${slugFromFcfa(code, 1000, 1000)}/">FCFA → ${code}</a>` : `<a href="../${slugToFcfa(code, 1, 1)}/">${code} → FCFA</a>`;

  const faq = [
    [`Combien vaut 1 ${code} en FCFA ?`, `Au ${dateFr(DATE)}, 1 ${code} (${name}) vaut environ ${fmt(toFcfa(code))} FCFA (XOF).`],
    [`Combien vaut 1 000 FCFA en ${code} ?`, `Au ${dateFr(DATE)}, 1 000 FCFA valent environ ${fmt(1000 / toFcfa(code))} ${code}.`],
    ['Le FCFA est-il lié à l’euro ?', 'Oui. Le franc CFA (XOF et XAF) a une parité fixe avec l’euro : 1 euro = 655,957 FCFA. Les autres devises varient selon leur cours face à l’euro.'],
    ['Ces taux sont-ils ceux de ma banque ?', 'Non. Ce sont des taux de marché indicatifs. Les banques, bureaux de change et services de transfert appliquent leur propre marge.'],
  ];
  const jsonld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([qq, aa]) => ({ '@type': 'Question', name: qq, acceptedAnswer: { '@type': 'Answer', text: aa } })) };

  const body = `
<h1>${esc(q)}</h1>
<div class="card"><div class="mut">Taux du ${dateFr(DATE)}</div>
<div class="big">${fmtInt(amount)} ${srcLabel} = ${fmt(result)} ${dstLabel}</div>
<div class="mut">1 ${srcLabel} = ${fmt(rateUnit)} ${dstLabel}</div></div>
${converterWidget(srcCode, dstCode, amount)}
${trend}
${affiliateBlock()}
<h2>Tableau de conversion ${srcLabel} → ${dstLabel}</h2>
<div class="card"><table><tr><th>${srcLabel}</th><th class="r">${dstLabel}</th></tr>${table}</table></div>
${histBlock}
<h2>Questions fréquentes</h2>
<div class="card">${faq.map(([qq, aa]) => `<details><summary>${esc(qq)}</summary><p>${esc(aa)}</p></details>`).join('')}</div>
<h2>Autres conversions</h2><div class="chips">${reverse}${other}</div>
${scriptTag()}`;
  pages.push({ path: slug, priority: amount === def ? 0.8 : 0.5, html: layout({ depth: 1, title, description: desc, canonicalPath: slug + '/', body, jsonld }) });
}

for (const { code } of currencies) {
  for (const n of config.amountsToFcfa) pairPage(code, 'toFcfa', n);
  for (const n of config.amountsFromFcfa) pairPage(code, 'fromFcfa', n);
}

// Page d'accueil
{
  const rows = currencies.map((c) => {
    const v7 = change(c.code, 7);
    return `<tr><td><a href="${slugToFcfa(c.code, 1, 1)}/"><strong>${c.code}</strong></a> <span class="mut">${esc(c.name)}</span></td>
<td class="r"><strong>${fmt(toFcfa(c.code))}</strong></td><td class="r"><a href="${slugFromFcfa(c.code, 1000, 1000)}/">${fmt(1000 / toFcfa(c.code))}</a></td><td class="r ${v7 && v7.pct >= 0 ? 'up' : 'dn'}">${pct(v7)}</td></tr>`;
  }).join('');
  const title = `Taux FCFA aujourd’hui : convertisseur Euro, Dollar, Dirham en Franc CFA (${dateFr(DATE)})`;
  const desc = `Convertisseur de devises vers le FCFA (XOF) mis à jour le ${dateFr(DATE)} : 1 euro = 655,957 FCFA, dollar, livre, dirham, naira, yuan et plus.`;
  const faq = [
    ['Quel est le taux euro FCFA ?', 'La parité est fixe : 1 euro = 655,957 FCFA.'],
    [`Combien vaut 1 dollar en FCFA aujourd’hui ?`, `Au ${dateFr(DATE)}, 1 USD vaut environ ${fmt(toFcfa('USD'))} FCFA.`],
  ];
  const jsonld = { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([qq, aa]) => ({ '@type': 'Question', name: qq, acceptedAnswer: { '@type': 'Answer', text: aa } })) };
  const body = `
<h1>Taux de change FCFA aujourd’hui</h1>
<p class="mut">${esc(config.tagline)}. Mise à jour du ${dateFr(DATE)}.</p>
${converterWidget('EUR', 'XOF', 1)}
${affiliateBlock()}
<h2>Toutes les devises face au FCFA</h2>
<div class="card" style="overflow-x:auto"><table>
<tr><th>Devise</th><th class="r">1 unité en FCFA</th><th class="r">1 000 FCFA en…</th><th class="r">7 jours</th></tr>${rows}</table></div>
<h2>À savoir</h2>
<div class="card"><p>Le franc CFA (XOF pour l’Afrique de l’Ouest, XAF pour l’Afrique centrale) est lié à l’euro par une <strong>parité fixe de 655,957 FCFA pour 1 euro</strong>. Quand l’euro monte face au dollar, le FCFA suit l’euro : 1 dollar vaut alors moins de FCFA.</p></div>
${scriptTag()}`;
  pages.push({ path: '', priority: 1, html: layout({ depth: 0, title, description: desc, canonicalPath: '', body, jsonld }) });
}

// Pages légales (nécessaires pour une régie publicitaire)
const contactLine = config.contactEmail ? `Contact : <a href="mailto:${esc(config.contactEmail)}">${esc(config.contactEmail)}</a>.` : '';
const staticPages = {
  'a-propos': ['À propos', `<p>${esc(config.siteName)} est un convertisseur de devises gratuit vers le franc CFA (FCFA). Les taux sont récupérés automatiquement chaque jour auprès de sources publiques et le site est mis à jour sans intervention manuelle.</p><p>Les informations sont données à titre indicatif et ne constituent pas un conseil financier. ${contactLine}</p>`],
  'mentions-legales': ['Mentions légales', `<p><strong>Éditeur :</strong> ${esc(config.ownerName || 'à compléter dans config.json')}.</p><p>${contactLine}</p><p><strong>Hébergement :</strong> GitHub Pages (GitHub, Inc.).</p><p>Les taux affichés sont indicatifs, fournis par ExchangeRate-API et/ou la Banque centrale européenne. L’éditeur ne saurait être tenu responsable d’une décision prise sur la base de ces informations.</p>`],
  confidentialite: ['Politique de confidentialité', `<p>Ce site ne demande aucun compte et ne collecte pas de données personnelles de lui-même. Le convertisseur fonctionne entièrement dans votre navigateur.</p><p>Le site peut afficher de la publicité (Google AdSense) et contenir des liens d’affiliation. Des tiers, dont Google, peuvent utiliser des cookies pour diffuser des annonces personnalisées selon vos visites sur ce site ou d’autres. Vous pouvez désactiver la personnalisation sur <a href="https://adssettings.google.com" rel="noopener">adssettings.google.com</a>.</p><p>${contactLine}</p>`],
};
for (const [slug, [t, content]] of Object.entries(staticPages)) {
  pages.push({ path: slug, priority: 0.2, html: layout({ depth: 1, title: `${t} – ${config.siteName}`, description: t, canonicalPath: slug + '/', body: `<h1>${t}</h1><div class="card">${content}</div>` }) });
}

/* ------------------------------------------------------------------ */
/* 5. Écriture de dist/                                                 */
/* ------------------------------------------------------------------ */
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await writeFile(join(DIST, 'style.css'), CSS.trim());
await writeFile(join(DIST, '.nojekyll'), '');
// Fichiers copiés tels quels à la racine du site (ex. vérification Google)
if (existsSync(join(ROOT, 'public'))) await cp(join(ROOT, 'public'), DIST, { recursive: true });
for (const p of pages) {
  const dir = join(DIST, p.path);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), p.html);
}
await writeFile(join(DIST, '404.html'), layout({ depth: 0, title: 'Page introuvable', description: 'Page introuvable', canonicalPath: '404.html', body: '<h1>Page introuvable</h1><p><a href="./">Retour au convertisseur</a></p>' }));

if (BASE_URL) {
  const urls = pages.filter((p) => p.priority > 0.2).map((p) => `<url><loc>${BASE_URL}/${p.path ? p.path + '/' : ''}</loc><lastmod>${DATE}</lastmod><priority>${p.priority}</priority></url>`).join('\n');
  await writeFile(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
  await writeFile(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`);
} else {
  await writeFile(join(DIST, 'robots.txt'), 'User-agent: *\nAllow: /\n');
}
if (config.adsenseClient) {
  const pub = config.adsenseClient.replace(/^ca-/, '');
  await writeFile(join(DIST, 'ads.txt'), `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`);
}

console.log(`OK : ${pages.length} pages générées · taux du ${DATE} (${snapshot.source}) · 1 USD = ${fmt(toFcfa('USD'))} FCFA`);
