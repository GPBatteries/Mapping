const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

// Zet deze secret eenmalig via:
//   firebase functions:secrets:set ANTHROPIC_API_KEY
const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");

const ANTHROPIC_MODEL = "claude-sonnet-5";
const BATCH_SIZE = 20; // max foto's per Claude-aanroep (batch)
const MAX_PHOTOS_PER_CHECK = 6; // spreid foto's over meerdere winkels i.p.v. 1 winkel leeg te trekken
const BATCH_CONCURRENCY = 3; // hoeveel batches tegelijk naar Claude sturen
const SAFETY_MAX_PHOTOS = 400; // harde bovengrens om kosten/rendertijd te beperken

// --- Budgetbewaking ---
// Standaardlimiet (USD) per kalendermaand als er geen aiUsage/config document bestaat.
// Pas aan zonder te redeployen: maak in Firestore een document "aiUsage/config" met
// veld monthlyBudgetUsd (getal). Dat overschrijft onderstaande default.
const DEFAULT_MONTHLY_BUDGET_USD = 25;

// Geschatte Anthropic-tarieven (Sonnet-klasse) — dit zijn benaderingen voor de
// budgetcalculatie, geen gegarandeerde actuele prijzen. Controleer/actualiseer via
// https://docs.claude.com als je zekerheid wilt over de exacte huidige tarieven.
const PRICE_PER_MTOK_INPUT_USD = 3;
const PRICE_PER_MTOK_OUTPUT_USD = 15;

// Voor de VOORAF-schatting (voordat er iets naar Claude is gestuurd):
const AVG_INPUT_TOKENS_PER_PHOTO = 320; // ruime schatting voor een ~400px thumbnail
const SYSTEM_PROMPT_TOKENS_ESTIMATE = 550; // per batch-aanroep
const OUTPUT_TOKENS_PER_BATCH_ESTIMATE = 3000;
const SYNTHESIS_OUTPUT_TOKENS_ESTIMATE = 4096;

const SCOPE_INSTRUCTION = `BELANGRIJKE SCOPE-BEPERKING: Deze storechecks gaan uitsluitend over batterijen (bv. AA/AAA/C/D/9V, knoopcellen, oplaadbare batterijen, opladers). Analyseer ALLEEN het batterijenschap/-schapdeel en batterijmerken (bv. Duracell, Energizer, Varta, GP, Panasonic, huismerken, etc.). Negeer volledig alle andere productcategorieen die toevallig ook op de foto staan (bv. lampen, speelgoed, elektronica, snoep, andere schappen op de achtergrond) — vermeld ze niet en betrek ze niet in de analyse, tenzij een foto uitsluitend niet-batterij producten toont; noem dat dan kort als "geen batterijenschap zichtbaar op deze foto" in plaats van die producten te analyseren.`;

/**
 * Callable function: analyzeStoreChecks
 * Input:
 *   {
 *     scopeLabel: string,           // bv. "Italie - juli 2026" (voor context in de prompt)
 *     instructions: string,         // optionele extra vraag/instructie van de gebruiker
 *     checks: [{
 *       chain, category, country, location, visitDate, notes,
 *       photos: [ { url, name } ]
 *     }]
 *   }
 * Output:
 *   { report, checksAnalyzed, photosAnalyzed, batchCount, truncated, runCostUsd, spentThisMonthUsd, monthlyBudgetUsd }
 */
exports.analyzeStoreChecks = onCall(
  {
    region: "europe-west1",
    secrets: [ANTHROPIC_API_KEY],
    timeoutSeconds: 540,
    memory: "1GiB",
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Je moet ingelogd zijn om een analyse te starten.");
    }

    const { checks, scopeLabel, instructions } = request.data || {};
    if (!Array.isArray(checks) || checks.length === 0) {
      throw new HttpsError("invalid-argument", "Geen storechecks meegegeven om te analyseren.");
    }

    const apiKey = ANTHROPIC_API_KEY.value();
    const scopeText = scopeLabel ? `Scope van deze analyse: ${scopeLabel}.` : "";
    const extraInstruction = instructions ? `Extra vraag van de gebruiker: ${instructions}` : "";

    // 1. Verzamel (check, photo) paren, max MAX_PHOTOS_PER_CHECK per check zodat 1 winkel
    //    met heel veel foto's niet alle ruimte opeet.
    const pairs = [];
    for (const check of checks) {
      const photos = (Array.isArray(check.photos) ? check.photos : []).slice(0, MAX_PHOTOS_PER_CHECK);
      for (const photo of photos) {
        if (photo && photo.url) pairs.push({ check, photo });
      }
    }

    let truncated = false;
    let workingPairs = pairs;
    if (workingPairs.length > SAFETY_MAX_PHOTOS) {
      truncated = true;
      workingPairs = workingPairs.slice(0, SAFETY_MAX_PHOTOS);
    }

    if (workingPairs.length === 0) {
      throw new HttpsError("failed-precondition", "Geen foto's gevonden om te analyseren.");
    }

    const estimatedBatchCount = Math.ceil(workingPairs.length / BATCH_SIZE);

    // 2. Budgetcheck VOORDAT er iets wordt gedownload of naar Claude gestuurd.
    const { monthlyBudgetUsd, spentThisMonthUsd, usageRef } = await getBudgetStatus();
    const estimatedCost = estimateRunCost(workingPairs.length, estimatedBatchCount);
    if (spentThisMonthUsd + estimatedCost > monthlyBudgetUsd) {
      throw new HttpsError(
        "resource-exhausted",
        `Budgetlimiet bereikt: deze analyse kost naar schatting $${estimatedCost.toFixed(2)}. ` +
          `Deze maand is al $${spentThisMonthUsd.toFixed(2)} gebruikt van de $${monthlyBudgetUsd.toFixed(2)} limiet. ` +
          `De analyse is NIET gestart. Verhoog de limiet (Firestore: aiUsage/config -> monthlyBudgetUsd) of wacht tot volgende maand.`
      );
    }

    // 3. Download + base64-encode alle foto's.
    const downloaded = await Promise.all(
      workingPairs.map(async ({ check, photo }) => {
        try {
          const response = await fetch(photo.url);
          if (!response.ok) throw new Error(`status ${response.status}`);
          const contentType = response.headers.get("content-type") || "image/jpeg";
          const arrayBuffer = await response.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          return { check, base64, mediaType: contentType.split(";")[0] };
        } catch (error) {
          console.error("Foto kon niet worden opgehaald:", photo.url, error);
          return null;
        }
      })
    );
    const validBlocks = downloaded.filter(Boolean);
    if (validBlocks.length === 0) {
      throw new HttpsError("failed-precondition", "Geen enkele foto kon worden opgehaald voor analyse.");
    }

    // 4. Verdeel in batches van BATCH_SIZE foto's.
    const batches = [];
    for (let i = 0; i < validBlocks.length; i += BATCH_SIZE) {
      batches.push(validBlocks.slice(i, i + BATCH_SIZE));
    }

    // 5. Analyseer elke batch (met beperkte concurrency i.v.m. rate limits).
    //    We houden de werkelijke kosten (op basis van de door Claude gerapporteerde
    //    tokens) bij, zodat we na afloop het echte bedrag kunnen bijschrijven.
    const batchReports = new Array(batches.length);
    let actualCost = 0;
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < batches.length) {
        const i = nextIndex;
        nextIndex += 1;
        const result = await analyzeBatch(batches[i], i + 1, batches.length, apiKey, scopeText, extraInstruction);
        batchReports[i] = result.text;
        actualCost += result.cost;
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, batches.length) }, () => worker()));

      // 6. Eén batch? Dan is dat meteen het eindrapport (geen synthese-stap nodig).
      let finalReport;
      if (batchReports.length === 1) {
        finalReport = batchReports[0];
      } else {
        const synthesis = await synthesizeReports(batchReports, apiKey, scopeText, extraInstruction);
        finalReport = synthesis.text;
        actualCost += synthesis.cost;
      }

      const newSpentThisMonth = await recordSpend(usageRef, actualCost);

      return {
        report: finalReport,
        checksAnalyzed: checks.length,
        photosAnalyzed: validBlocks.length,
        batchCount: batches.length,
        truncated,
        runCostUsd: actualCost,
        spentThisMonthUsd: newSpentThisMonth,
        monthlyBudgetUsd,
      };
    } catch (error) {
      // Ook bij een fout halverwege: schrijf de al gemaakte kosten bij, dan pas de fout doorgeven.
      if (actualCost > 0) {
        await recordSpend(usageRef, actualCost).catch((e) => console.error("Kon partiele kosten niet opslaan:", e));
      }
      if (error instanceof HttpsError) throw error;
      console.error("Analyse mislukt:", error);
      throw new HttpsError("internal", "Analyse is onverwacht mislukt. Probeer het opnieuw.");
    }
  }
);

/**
 * Haalt het huidige maandbudget en het al bestede bedrag deze maand op.
 */
async function getBudgetStatus() {
  const monthKey = new Date().toISOString().slice(0, 7); // "2026-07"
  const usageRef = db.collection("aiUsage").doc(monthKey);
  const configRef = db.collection("aiUsage").doc("config");

  const [usageSnap, configSnap] = await Promise.all([usageRef.get(), configRef.get()]);
  const spentThisMonthUsd = usageSnap.exists ? Number(usageSnap.data().spentUsd || 0) : 0;
  const monthlyBudgetUsd =
    configSnap.exists && typeof configSnap.data().monthlyBudgetUsd === "number"
      ? configSnap.data().monthlyBudgetUsd
      : DEFAULT_MONTHLY_BUDGET_USD;

  return { monthlyBudgetUsd, spentThisMonthUsd, usageRef };
}

/**
 * Schrijft een bedrag bij op de teller van deze maand en geeft het nieuwe totaal terug.
 */
async function recordSpend(usageRef, amountUsd) {
  if (!amountUsd || amountUsd <= 0) {
    const snap = await usageRef.get();
    return snap.exists ? Number(snap.data().spentUsd || 0) : 0;
  }
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(usageRef);
    const current = snap.exists ? Number(snap.data().spentUsd || 0) : 0;
    const updated = current + amountUsd;
    tx.set(usageRef, { spentUsd: updated, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return updated;
  });
  return result;
}

/**
 * Grove vooraf-schatting van de kosten van deze run, puur om de budgetlimiet te checken
 * voordat er iets wordt uitgegeven.
 */
function estimateRunCost(photoCount, batchCount) {
  const estimatedInputTokens = photoCount * AVG_INPUT_TOKENS_PER_PHOTO + batchCount * SYSTEM_PROMPT_TOKENS_ESTIMATE;
  const estimatedOutputTokens =
    batchCount * OUTPUT_TOKENS_PER_BATCH_ESTIMATE + (batchCount > 1 ? SYNTHESIS_OUTPUT_TOKENS_ESTIMATE : 0);
  return (
    (estimatedInputTokens / 1_000_000) * PRICE_PER_MTOK_INPUT_USD +
    (estimatedOutputTokens / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD
  );
}

/**
 * Berekent de werkelijke kosten van 1 Claude-aanroep op basis van de teruggegeven usage.
 */
function computeActualCost(usage) {
  if (!usage) return 0;
  const inputCost = ((usage.input_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_INPUT_USD;
  const outputCost = ((usage.output_tokens || 0) / 1_000_000) * PRICE_PER_MTOK_OUTPUT_USD;
  return inputCost + outputCost;
}

/**
 * Bouwt de content-array (tekst + afbeeldingen) voor 1 batch, gegroepeerd per storecheck.
 */
function buildBatchContent(batchBlocks) {
  const content = [];
  let currentCheck = null;
  for (const block of batchBlocks) {
    if (block.check !== currentCheck) {
      currentCheck = block.check;
      const meta = [
        `Keten: ${currentCheck.chain || "onbekend"}`,
        `Categorie: ${currentCheck.category || "-"}`,
        `Land: ${currentCheck.country || "-"}`,
        `Filiaal/locatie: ${currentCheck.location || "-"}`,
        `Bezoekdatum: ${currentCheck.visitDate || "-"}`,
        `Notities veldwerker: ${currentCheck.notes || "geen notities"}`,
      ].join("\n");
      content.push({ type: "text", text: `--- Storecheck ---\n${meta}` });
    }
    content.push({
      type: "image",
      source: { type: "base64", media_type: block.mediaType, data: block.base64 },
    });
  }
  return content;
}

/**
 * Analyseert 1 batch foto's en levert een deelrapport (Markdown) + de werkelijke kosten op.
 */
async function analyzeBatch(batchBlocks, batchNumber, totalBatches, apiKey, scopeText, extraInstruction) {
  const content = buildBatchContent(batchBlocks);
  const batchNote =
    totalBatches > 1
      ? `Dit is deel ${batchNumber} van ${totalBatches} van een grotere analyse. Rapporteer alleen over de storechecks/foto's die je in DIT deel ziet — een aparte stap voegt straks alle delen samen. Herhaal geen aannames over andere delen.`
      : "";

  const systemPrompt = `Je bent een senior retail/shelf-analist voor een batterijenfabrikant die concurrentieonderzoek doet via storechecks (schapfoto's + veldnotities).
${scopeText}
${batchNote}
Je krijgt een reeks foto's van winkelschappen, gegroepeerd per storecheck (met keten, land, locatie, datum en notities van de veldwerker).
${extraInstruction}

${SCOPE_INSTRUCTION}

Analyseer per winkelketen/filiaal wat je op het batterijenschap ziet: welke batterijmerken aanwezig zijn, geschat schapaandeel (aantal facings/frontings t.o.v. het totale batterijenschap indien zichtbaar), welke batterijtypes/formaten liggen (AA, AAA, oplaadbaar, etc.), zichtbare prijzen (noteer expliciet als een prijs niet leesbaar is, verzin nooit een prijs), promoties/acties op batterijen, schapindeling/plaatsing en opvallende observaties.

Structureer je antwoord in Markdown met:
1. Tabel: Keten | Land/Locatie | Belangrijkste batterijmerken gezien | Prijsrange batterijen | Opvallendste observatie
2. Per keten/filiaal een korte sectie met bevindingen over het batterijenschap
3. Losse bullet-lijst met alle prijzen die je met zekerheid kon aflezen (merk, type, prijs, winkel)

Wees expliciet onzeker wanneer een foto onduidelijk is. Verzin geen merken of prijzen die je niet kunt zien. Rapporteer niets over producten buiten de batterijencategorie.`;

  const data = await callClaude(apiKey, systemPrompt, content, 3000);
  return { text: extractText(data), cost: computeActualCost(data.usage) };
}

/**
 * Voegt meerdere deelrapporten samen tot 1 uniform eindrapport (tekst-only aanroep, geen foto's meer nodig).
 */
async function synthesizeReports(batchReports, apiKey, scopeText, extraInstruction) {
  const combinedInput = batchReports
    .map((report, index) => `=== Deelrapport ${index + 1} van ${batchReports.length} ===\n${report}`)
    .join("\n\n");

  const systemPrompt = `Je bent een senior retail/shelf-analist voor een batterijenfabrikant. Je krijgt hieronder meerdere deelrapporten die elk een deel van dezelfde storecheck-analyse behandelen (dezelfde algehele scope, verschillende winkels/foto's per deel).
${scopeText}
${extraInstruction}

${SCOPE_INSTRUCTION}

Jouw taak: voeg alle deelrapporten samen tot EEN samenhangend eindrapport. Combineer overlappende informatie (bv. als dezelfde keten in meerdere delen voorkomt, groepeer die bevindingen samen), verwijder duplicaten, maar verlies geen enkele winkel/observatie/prijs uit de deelrapporten.

Structureer het eindrapport in Markdown:
1. Korte samenvatting (4-6 zinnen) over de hele analyse, alleen over batterijen
2. Volledige tabel: Keten | Land/Locatie | Belangrijkste batterijmerken gezien | Prijsrange batterijen | Opvallendste observatie (neem ALLE rijen uit de deelrapporten over, gegroepeerd per keten waar logisch)
3. Per keten een sectie met bevindingen over het batterijenschap (combineer info uit meerdere filialen van dezelfde keten)
4. Sectie "Prijsvergelijking batterijen" met alle prijzen die met zekerheid zijn afgelezen (merk, type, prijs, winkel/land)
5. Sectie "Aanbevelingen" met 3-5 concrete actiepunten gericht op batterijen (schapaandeel, prijsstelling, plaatsing, promoties)

Verzin geen merken, winkels of prijzen die niet in de deelrapporten staan. Rapporteer niets over producten buiten de batterijencategorie.

Hier zijn de deelrapporten:

${combinedInput}`;

  const data = await callClaude(
    apiKey,
    systemPrompt,
    [{ type: "text", text: "Maak het samengevoegde eindrapport zoals hierboven geinstrueerd." }],
    4096
  );
  return { text: extractText(data), cost: computeActualCost(data.usage) };
}

async function callClaude(apiKey, systemPrompt, content, maxTokens) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("Anthropic API fout:", response.status, errorBody);
    throw new HttpsError("internal", `Claude API fout (${response.status}). Controleer je API key.`);
  }

  return response.json();
}

function extractText(data) {
  return (data.content || [])
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n\n");
}
