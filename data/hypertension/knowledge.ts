/**
 * Curated hypertension knowledge base.
 *
 * Structured facts (dose ranges, line of therapy, modifiers) are transcribed from
 * the sources cited on each row. Free-text FDA label content and RxNorm codes /
 * strengths are filled in by scripts/scrape-hypertension.ts.
 *
 * This is a demo dataset. It is not a substitute for clinical judgement.
 */

export const SOURCES = {
  acc2025: {
    label: "2025 AHA/ACC High Blood Pressure Guideline",
    url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000249",
  },
  acc2017: {
    label: "2017 ACC/AHA High Blood Pressure Guideline (Table 18, Table 19)",
    url: "https://www.ahajournals.org/doi/10.1161/HYP.0000000000000065",
  },
  hf2022: {
    label: "2022 AHA/ACC/HFSA Heart Failure Guideline",
    url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001063",
  },
  kdigo2021: {
    label: "KDIGO 2021 Blood Pressure in CKD Guideline",
    url: "https://kdigo.org/guidelines/blood-pressure-in-ckd/",
  },
  ada2025: {
    label: "ADA Standards of Care in Diabetes 2025, Section 10",
    url: "https://diabetesjournals.org/care/article/48/Supplement_1/S207/157549",
  },
  acog2019: {
    label: "ACOG Practice Bulletin 203: Chronic Hypertension in Pregnancy",
    url: "https://www.acog.org/clinical/clinical-guidance/practice-bulletin/articles/2019/01/chronic-hypertension-in-pregnancy",
  },
  beers2023: {
    label: "AGS Beers Criteria 2023",
    url: "https://agsjournals.onlinelibrary.wiley.com/doi/10.1111/jgs.18372",
  },
  allhat: {
    label: "ALLHAT (JAMA 2002)",
    url: "https://jamanetwork.com/journals/jama/fullarticle/195626",
  },
  pathway2: {
    label: "PATHWAY-2 (Lancet 2015)",
    url: "https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(15)00257-3/fulltext",
  },
  click: {
    label: "CLICK trial — chlorthalidone in stage 4 CKD (NEJM 2021)",
    url: "https://www.nejm.org/doi/full/10.1056/NEJMoa2110730",
  },
  law2009: {
    label: "Law, Morris & Wald — BP-lowering drug meta-analysis (BMJ 2009)",
    url: "https://www.bmj.com/content/338/bmj.b1665",
  },
  aheft: {
    label: "A-HeFT (NEJM 2004)",
    url: "https://www.nejm.org/doi/full/10.1056/NEJMoa042934",
  },
  ontarget: {
    label: "ONTARGET (NEJM 2008) / VA NEPHRON-D (NEJM 2013)",
    url: "https://www.nejm.org/doi/full/10.1056/NEJMoa0801317",
  },
  fdaLabel: {
    label: "FDA prescribing information (openFDA / DailyMed)",
    url: "https://open.fda.gov/apis/drug/label/",
  },
  aceiAngioedema: {
    label: "Kostis et al. — ACE-inhibitor angioedema incidence by race (OCTAVE, Am J Hypertens 2005)",
    url: "https://academic.oup.com/ajh/article/18/1/25/150553",
  },
  aceiCough: {
    label: "McDowell et al. — ACE-inhibitor cough incidence in East Asian patients (BMJ 2006 meta-analysis)",
    url: "https://pubmed.ncbi.nlm.nih.gov/16547304/",
  },
  topcat: {
    label: "TOPCAT (NEJM 2014)",
    url: "https://www.nejm.org/doi/full/10.1056/NEJMoa1313731",
  },
} as const;

export type SourceKey = keyof typeof SOURCES;

export const DIAGNOSES = [
  {
    id: "essential_hypertension",
    name: "Essential (primary) hypertension",
    icd10: "I10",
    description: "Sustained BP ≥130/80 mmHg without an identified secondary cause.",
  },
  {
    id: "hypertensive_heart_disease",
    name: "Hypertensive heart disease without heart failure",
    icd10: "I11.9",
    description: "Hypertension with target-organ cardiac involvement (e.g. LVH) without HF.",
  },
  {
    id: "hypertensive_heart_disease_hf",
    name: "Hypertensive heart disease with heart failure",
    icd10: "I11.0",
    description: "Hypertension with heart failure.",
  },
  {
    id: "hypertensive_ckd",
    name: "Hypertensive chronic kidney disease",
    icd10: "I12.9",
    description: "Hypertension with CKD stage 1–4.",
  },
  {
    id: "resistant_hypertension",
    name: "Resistant hypertension",
    icd10: "I1A.0",
    description: "BP above goal despite 3 agents of different classes (incl. a diuretic) at optimal doses.",
  },
  {
    id: "secondary_hypertension_aldosteronism",
    name: "Hypertension secondary to primary aldosteronism",
    icd10: "I15.2",
    description: "Hypertension due to autonomous aldosterone production.",
  },
  {
    id: "pre_existing_hypertension_pregnancy",
    name: "Pre-existing essential hypertension complicating pregnancy",
    icd10: "O10.019",
    description: "Chronic hypertension in a pregnant patient.",
  },
] as const;

export type DrugSeed = {
  id: string;
  generic: string;
  brands: string[];
  drugClass: string;
  classKey: string;
  mechanism: string;
  usualMin: number;
  usualMax: number;
  start: number;
  startElderly?: number;
  dosesPerDay: string;
  monitoring: string;
  pregnancy: "contraindicated" | "avoid" | "caution" | "preferred";
  costTier: 1 | 2 | 3;
  /** RxNorm name to resolve (defaults to generic) */
  rxnormName?: string;
  /** openFDA generic_name to search (defaults to generic upper-cased) */
  fdaName?: string;
};

// Dose ranges: 2017 ACC/AHA Table 18 (unchanged in 2025 guideline) unless noted.
export const DRUGS: DrugSeed[] = [
  // Thiazide / thiazide-like diuretics
  { id: "chlorthalidone", generic: "chlorthalidone", brands: ["Thalitone"], drugClass: "Thiazide-like diuretic", classKey: "thiazide", mechanism: "Inhibits Na-Cl cotransporter in the distal convoluted tubule.", usualMin: 12.5, usualMax: 25, start: 12.5, dosesPerDay: "1", monitoring: "BMP (Na, K, Cr), uric acid, glucose at 2–4 weeks", pregnancy: "caution", costTier: 1 },
  { id: "hydrochlorothiazide", generic: "hydrochlorothiazide", brands: ["Microzide"], drugClass: "Thiazide diuretic", classKey: "thiazide", mechanism: "Inhibits Na-Cl cotransporter in the distal convoluted tubule.", usualMin: 12.5, usualMax: 50, start: 12.5, dosesPerDay: "1", monitoring: "BMP (Na, K, Cr), uric acid, glucose at 2–4 weeks", pregnancy: "caution", costTier: 1 },
  { id: "indapamide", generic: "indapamide", brands: ["Lozol"], drugClass: "Thiazide-like diuretic", classKey: "thiazide", mechanism: "Thiazide-like Na-Cl cotransporter inhibitor with vasodilatory effects.", usualMin: 1.25, usualMax: 2.5, start: 1.25, dosesPerDay: "1", monitoring: "BMP (Na, K), at 2–4 weeks", pregnancy: "caution", costTier: 1 },

  // ACE inhibitors
  { id: "lisinopril", generic: "lisinopril", brands: ["Zestril", "Prinivil"], drugClass: "ACE inhibitor", classKey: "acei", mechanism: "Inhibits angiotensin-converting enzyme, lowering angiotensin II and aldosterone.", usualMin: 10, usualMax: 40, start: 10, startElderly: 5, dosesPerDay: "1", monitoring: "BMP (K, Cr) at 1–2 weeks after start/titration", pregnancy: "contraindicated", costTier: 1 },
  { id: "enalapril", generic: "enalapril", brands: ["Vasotec"], drugClass: "ACE inhibitor", classKey: "acei", mechanism: "Inhibits angiotensin-converting enzyme.", usualMin: 5, usualMax: 40, start: 5, startElderly: 2.5, dosesPerDay: "1-2", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1, fdaName: "ENALAPRIL MALEATE" },
  { id: "ramipril", generic: "ramipril", brands: ["Altace"], drugClass: "ACE inhibitor", classKey: "acei", mechanism: "Inhibits angiotensin-converting enzyme.", usualMin: 2.5, usualMax: 20, start: 2.5, dosesPerDay: "1-2", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1 },
  { id: "benazepril", generic: "benazepril", brands: ["Lotensin"], drugClass: "ACE inhibitor", classKey: "acei", mechanism: "Inhibits angiotensin-converting enzyme.", usualMin: 10, usualMax: 40, start: 10, startElderly: 5, dosesPerDay: "1-2", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1, fdaName: "BENAZEPRIL HYDROCHLORIDE" },
  { id: "quinapril", generic: "quinapril", brands: ["Accupril"], drugClass: "ACE inhibitor", classKey: "acei", mechanism: "Inhibits angiotensin-converting enzyme.", usualMin: 10, usualMax: 80, start: 10, dosesPerDay: "1-2", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1, fdaName: "QUINAPRIL" },

  // ARBs
  { id: "losartan", generic: "losartan", brands: ["Cozaar"], drugClass: "Angiotensin II receptor blocker", classKey: "arb", mechanism: "Blocks the AT1 receptor. Mild uricosuric effect.", usualMin: 50, usualMax: 100, start: 50, startElderly: 25, dosesPerDay: "1-2", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1, fdaName: "LOSARTAN POTASSIUM" },
  { id: "valsartan", generic: "valsartan", brands: ["Diovan"], drugClass: "Angiotensin II receptor blocker", classKey: "arb", mechanism: "Blocks the AT1 receptor.", usualMin: 80, usualMax: 320, start: 80, dosesPerDay: "1", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1 },
  { id: "olmesartan", generic: "olmesartan", brands: ["Benicar"], drugClass: "Angiotensin II receptor blocker", classKey: "arb", mechanism: "Blocks the AT1 receptor.", usualMin: 20, usualMax: 40, start: 20, dosesPerDay: "1", monitoring: "BMP (K, Cr); watch for sprue-like enteropathy", pregnancy: "contraindicated", costTier: 1, rxnormName: "olmesartan", fdaName: "OLMESARTAN MEDOXOMIL" },
  { id: "irbesartan", generic: "irbesartan", brands: ["Avapro"], drugClass: "Angiotensin II receptor blocker", classKey: "arb", mechanism: "Blocks the AT1 receptor.", usualMin: 150, usualMax: 300, start: 150, dosesPerDay: "1", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1 },
  { id: "telmisartan", generic: "telmisartan", brands: ["Micardis"], drugClass: "Angiotensin II receptor blocker", classKey: "arb", mechanism: "Blocks the AT1 receptor. Long half-life.", usualMin: 20, usualMax: 80, start: 40, dosesPerDay: "1", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 1 },
  { id: "candesartan", generic: "candesartan", brands: ["Atacand"], drugClass: "Angiotensin II receptor blocker", classKey: "arb", mechanism: "Blocks the AT1 receptor.", usualMin: 8, usualMax: 32, start: 16, dosesPerDay: "1", monitoring: "BMP (K, Cr) at 1–2 weeks", pregnancy: "contraindicated", costTier: 2, rxnormName: "candesartan", fdaName: "CANDESARTAN CILEXETIL" },

  // Dihydropyridine CCBs
  { id: "amlodipine", generic: "amlodipine", brands: ["Norvasc"], drugClass: "Dihydropyridine calcium channel blocker", classKey: "ccb_dhp", mechanism: "Blocks L-type calcium channels in vascular smooth muscle.", usualMin: 2.5, usualMax: 10, start: 5, startElderly: 2.5, dosesPerDay: "1", monitoring: "Peripheral edema, BP/HR at 2–4 weeks", pregnancy: "caution", costTier: 1, fdaName: "AMLODIPINE BESYLATE" },
  { id: "nifedipine_er", generic: "nifedipine extended-release", brands: ["Procardia XL", "Adalat CC"], drugClass: "Dihydropyridine calcium channel blocker", classKey: "ccb_dhp", mechanism: "Blocks L-type calcium channels in vascular smooth muscle.", usualMin: 30, usualMax: 90, start: 30, dosesPerDay: "1", monitoring: "Peripheral edema, headache, BP/HR", pregnancy: "preferred", costTier: 1, rxnormName: "nifedipine", fdaName: "NIFEDIPINE" },
  { id: "felodipine", generic: "felodipine extended-release", brands: ["Plendil"], drugClass: "Dihydropyridine calcium channel blocker", classKey: "ccb_dhp", mechanism: "Blocks L-type calcium channels in vascular smooth muscle.", usualMin: 2.5, usualMax: 10, start: 5, startElderly: 2.5, dosesPerDay: "1", monitoring: "Peripheral edema; avoid grapefruit", pregnancy: "caution", costTier: 1, rxnormName: "felodipine", fdaName: "FELODIPINE" },

  // Non-dihydropyridine CCBs
  { id: "diltiazem_er", generic: "diltiazem extended-release", brands: ["Cardizem CD", "Tiazac"], drugClass: "Non-dihydropyridine calcium channel blocker", classKey: "ccb_nondhp", mechanism: "Blocks L-type calcium channels in heart and vasculature; slows AV conduction.", usualMin: 120, usualMax: 360, start: 120, dosesPerDay: "1", monitoring: "HR, ECG (PR interval), drug interactions (CYP3A4)", pregnancy: "caution", costTier: 2, rxnormName: "diltiazem", fdaName: "DILTIAZEM HYDROCHLORIDE" },
  { id: "verapamil_er", generic: "verapamil extended-release", brands: ["Calan SR", "Isoptin SR"], drugClass: "Non-dihydropyridine calcium channel blocker", classKey: "ccb_nondhp", mechanism: "Blocks L-type calcium channels; slows AV conduction.", usualMin: 120, usualMax: 480, start: 120, dosesPerDay: "1-2", monitoring: "HR, constipation, digoxin levels if co-prescribed", pregnancy: "caution", costTier: 1, rxnormName: "verapamil", fdaName: "VERAPAMIL HYDROCHLORIDE" },

  // Beta blockers
  { id: "metoprolol_succinate", generic: "metoprolol succinate", brands: ["Toprol-XL"], drugClass: "Beta blocker (cardioselective)", classKey: "beta_blocker", mechanism: "Selective β1-adrenergic blockade.", usualMin: 50, usualMax: 200, start: 25, dosesPerDay: "1", monitoring: "HR, BP; do not stop abruptly", pregnancy: "caution", costTier: 1, rxnormName: "metoprolol", fdaName: "METOPROLOL SUCCINATE" },
  { id: "carvedilol", generic: "carvedilol", brands: ["Coreg"], drugClass: "Beta blocker (combined α/β)", classKey: "beta_blocker", mechanism: "Non-selective β blockade with α1 blockade.", usualMin: 12.5, usualMax: 50, start: 6.25, dosesPerDay: "2", monitoring: "HR, BP, orthostasis; take with food", pregnancy: "caution", costTier: 1 },
  { id: "bisoprolol", generic: "bisoprolol", brands: ["Zebeta"], drugClass: "Beta blocker (cardioselective)", classKey: "beta_blocker", mechanism: "Highly selective β1-adrenergic blockade.", usualMin: 2.5, usualMax: 10, start: 2.5, dosesPerDay: "1", monitoring: "HR, BP", pregnancy: "caution", costTier: 1, fdaName: "BISOPROLOL FUMARATE" },
  { id: "nebivolol", generic: "nebivolol", brands: ["Bystolic"], drugClass: "Beta blocker (cardioselective, vasodilatory)", classKey: "beta_blocker", mechanism: "Selective β1 blockade with nitric-oxide–mediated vasodilation.", usualMin: 5, usualMax: 40, start: 5, dosesPerDay: "1", monitoring: "HR, BP", pregnancy: "caution", costTier: 2 },
  { id: "atenolol", generic: "atenolol", brands: ["Tenormin"], drugClass: "Beta blocker (cardioselective)", classKey: "beta_blocker", mechanism: "Selective β1-adrenergic blockade; renally cleared.", usualMin: 25, usualMax: 100, start: 25, dosesPerDay: "1", monitoring: "HR; dose-adjust for CrCl <35", pregnancy: "contraindicated", costTier: 1 },
  { id: "labetalol", generic: "labetalol", brands: ["Trandate"], drugClass: "Beta blocker (combined α/β)", classKey: "beta_blocker", mechanism: "Non-selective β blockade with α1 blockade.", usualMin: 200, usualMax: 800, start: 100, dosesPerDay: "2", monitoring: "HR, BP, LFTs (rare hepatotoxicity)", pregnancy: "preferred", costTier: 1, fdaName: "LABETALOL HYDROCHLORIDE" },
  { id: "propranolol_la", generic: "propranolol extended-release", brands: ["Inderal LA"], drugClass: "Beta blocker (non-selective)", classKey: "beta_blocker", mechanism: "Non-selective β-adrenergic blockade.", usualMin: 80, usualMax: 160, start: 80, dosesPerDay: "1", monitoring: "HR, BP; bronchospasm", pregnancy: "caution", costTier: 1, rxnormName: "propranolol", fdaName: "PROPRANOLOL HYDROCHLORIDE" },

  // Mineralocorticoid receptor antagonists
  { id: "spironolactone", generic: "spironolactone", brands: ["Aldactone", "CaroSpir"], drugClass: "Mineralocorticoid receptor antagonist", classKey: "mra", mechanism: "Competitive aldosterone receptor antagonist.", usualMin: 25, usualMax: 100, start: 25, startElderly: 12.5, dosesPerDay: "1", monitoring: "K and Cr at 3 days, 1 week, then monthly ×3", pregnancy: "contraindicated", costTier: 1 },
  { id: "eplerenone", generic: "eplerenone", brands: ["Inspra"], drugClass: "Mineralocorticoid receptor antagonist", classKey: "mra", mechanism: "Selective aldosterone receptor antagonist (fewer anti-androgenic effects).", usualMin: 50, usualMax: 100, start: 50, dosesPerDay: "1-2", monitoring: "K and Cr; CYP3A4 interactions", pregnancy: "contraindicated", costTier: 2 },

  // Loop & potassium-sparing diuretics
  { id: "furosemide", generic: "furosemide", brands: ["Lasix"], drugClass: "Loop diuretic", classKey: "loop", mechanism: "Inhibits Na-K-2Cl cotransporter in the loop of Henle.", usualMin: 20, usualMax: 80, start: 20, dosesPerDay: "2", monitoring: "BMP (K, Na, Cr), volume status", pregnancy: "caution", costTier: 1 },
  { id: "torsemide", generic: "torsemide", brands: ["Soaanz"], drugClass: "Loop diuretic", classKey: "loop", mechanism: "Inhibits Na-K-2Cl cotransporter; long-acting.", usualMin: 5, usualMax: 10, start: 5, dosesPerDay: "1", monitoring: "BMP (K, Na, Cr), volume status", pregnancy: "caution", costTier: 1 },
  { id: "amiloride", generic: "amiloride", brands: ["Midamor"], drugClass: "Potassium-sparing diuretic", classKey: "k_sparing", mechanism: "Blocks epithelial sodium channel (ENaC) in collecting duct.", usualMin: 5, usualMax: 10, start: 5, dosesPerDay: "1-2", monitoring: "K and Cr", pregnancy: "caution", costTier: 1, fdaName: "AMILORIDE HYDROCHLORIDE" },

  // Secondary agents
  { id: "doxazosin", generic: "doxazosin", brands: ["Cardura"], drugClass: "Alpha-1 blocker", classKey: "alpha_blocker", mechanism: "Selective α1-adrenergic blockade.", usualMin: 1, usualMax: 16, start: 1, dosesPerDay: "1", monitoring: "Orthostatic BP; first-dose syncope", pregnancy: "caution", costTier: 1, fdaName: "DOXAZOSIN MESYLATE" },
  { id: "clonidine", generic: "clonidine", brands: ["Catapres"], drugClass: "Central alpha-2 agonist", classKey: "central_alpha", mechanism: "Central α2 agonist reducing sympathetic outflow.", usualMin: 0.1, usualMax: 0.8, start: 0.1, dosesPerDay: "2", monitoring: "Sedation, rebound HTN if stopped abruptly", pregnancy: "caution", costTier: 1, fdaName: "CLONIDINE HYDROCHLORIDE" },
  { id: "methyldopa", generic: "methyldopa", brands: ["Aldomet"], drugClass: "Central alpha-2 agonist", classKey: "central_alpha", mechanism: "Central α2 agonist (via α-methylnorepinephrine).", usualMin: 250, usualMax: 1000, start: 250, dosesPerDay: "2", monitoring: "LFTs, Coombs test, sedation", pregnancy: "preferred", costTier: 1 },
  { id: "hydralazine", generic: "hydralazine", brands: ["Apresoline"], drugClass: "Direct vasodilator", classKey: "vasodilator", mechanism: "Direct arteriolar smooth-muscle relaxation.", usualMin: 100, usualMax: 200, start: 25, dosesPerDay: "2-3", monitoring: "Reflex tachycardia, fluid retention, lupus-like syndrome (ANA)", pregnancy: "caution", costTier: 1, fdaName: "HYDRALAZINE HYDROCHLORIDE" },
  { id: "aliskiren", generic: "aliskiren", brands: ["Tekturna"], drugClass: "Direct renin inhibitor", classKey: "renin_inhibitor", mechanism: "Direct renin inhibition.", usualMin: 150, usualMax: 300, start: 150, dosesPerDay: "1", monitoring: "K, Cr", pregnancy: "contraindicated", costTier: 3, fdaName: "ALISKIREN" },
];

/** Average SBP reduction (mmHg) at standard dose by class — Law 2009 BMJ meta-analysis. */
export const CLASS_EFFICACY: Record<string, number> = {
  thiazide: 8.8,
  beta_blocker: 9.2,
  acei: 8.5,
  arb: 10.3,
  ccb_dhp: 8.8,
  ccb_nondhp: 8.8,
};

type Line = "first_line" | "second_line" | "add_on" | "special_population";

const FIRST_LINE_CLASSES = ["thiazide", "acei", "arb", "ccb_dhp"];

/** TABLE 1 builder: line of therapy per diagnosis per drug */
export function buildDiagnosisMedications() {
  const rows: { diagnosis_id: string; medication_id: string; line_of_therapy: Line; base_score: number; guideline: string; notes: string }[] = [];
  const add = (dx: string, med: string, line: Line, score: number, guideline: SourceKey, notes: string) =>
    rows.push({ diagnosis_id: dx, medication_id: med, line_of_therapy: line, base_score: score, guideline: SOURCES[guideline].label, notes });

  for (const d of DRUGS) {
    // Essential HTN & hypertensive heart disease without HF
    for (const dx of ["essential_hypertension", "hypertensive_heart_disease"]) {
      if (FIRST_LINE_CLASSES.includes(d.classKey)) {
        const penalty = d.id === "hydrochlorothiazide" ? 3 : 0; // chlorthalidone/indapamide preferred (longer acting, outcome data)
        add(dx, d.id, "first_line", 70 - penalty, "acc2025", "First-line class: thiazide, ACEi, ARB or DHP CCB.");
      } else if (["beta_blocker", "mra", "ccb_nondhp", "loop", "k_sparing"].includes(d.classKey)) {
        add(dx, d.id, "second_line", d.classKey === "beta_blocker" ? 50 : 45, "acc2017", "Second-line unless a compelling indication exists.");
      } else {
        add(dx, d.id, "add_on", 30, "acc2017", "Reserved for add-on / resistant therapy.");
      }
    }
    // HTN with HF (HFrEF assumed; modifiers handle HFpEF)
    {
      const gdmt = ["carvedilol", "metoprolol_succinate", "bisoprolol", "spironolactone", "eplerenone", "furosemide", "torsemide"];
      if (gdmt.includes(d.id) || d.classKey === "acei" || d.classKey === "arb") {
        add("hypertensive_heart_disease_hf", d.id, "first_line", 72, "hf2022", "Guideline-directed medical therapy for HF.");
      } else if (["amlodipine", "felodipine", "chlorthalidone", "hydrochlorothiazide", "indapamide", "hydralazine"].includes(d.id)) {
        add("hypertensive_heart_disease_hf", d.id, "add_on", 40, "hf2022", "Add-on for BP control once GDMT optimised.");
      } else {
        add("hypertensive_heart_disease_hf", d.id, "add_on", 20, "hf2022", "Not preferred in HF.");
      }
    }
    // HTN with CKD
    if (d.classKey === "acei" || d.classKey === "arb") add("hypertensive_ckd", d.id, "first_line", 75, "kdigo2021", "RAAS blockade preferred with albuminuria / eGFR <60.");
    else if (FIRST_LINE_CLASSES.includes(d.classKey) || d.classKey === "loop") add("hypertensive_ckd", d.id, "second_line", 55, "kdigo2021", "Add-on after maximally tolerated ACEi/ARB.");
    else add("hypertensive_ckd", d.id, "add_on", 35, "kdigo2021", "Add-on agent.");

    // Resistant HTN
    if (d.id === "spironolactone") add("resistant_hypertension", d.id, "first_line", 82, "pathway2", "Preferred fourth-line agent (PATHWAY-2).");
    else if (["eplerenone", "amiloride"].includes(d.id)) add("resistant_hypertension", d.id, "second_line", 65, "pathway2", "Alternative if spironolactone not tolerated.");
    else if (["chlorthalidone", "indapamide"].includes(d.id)) add("resistant_hypertension", d.id, "first_line", 68, "acc2017", "Switch to long-acting thiazide-like diuretic.");
    else if (["doxazosin", "bisoprolol", "hydralazine", "clonidine"].includes(d.id)) add("resistant_hypertension", d.id, "add_on", 45, "pathway2", "Fifth-line options.");
    else add("resistant_hypertension", d.id, "add_on", 35, "acc2017", "Usually already on board.");

    // Primary aldosteronism
    if (d.id === "spironolactone") add("secondary_hypertension_aldosteronism", d.id, "first_line", 88, "acc2025", "MRA is medical therapy of choice for primary aldosteronism.");
    else if (d.id === "eplerenone") add("secondary_hypertension_aldosteronism", d.id, "first_line", 78, "acc2025", "Alternative MRA with fewer anti-androgenic effects.");
    else if (d.id === "amiloride") add("secondary_hypertension_aldosteronism", d.id, "second_line", 60, "acc2017", "ENaC blocker if MRA not tolerated.");
    else add("secondary_hypertension_aldosteronism", d.id, "add_on", 35, "acc2017", "Add-on for BP control.");

    // Pregnancy
    if (["labetalol", "nifedipine_er"].includes(d.id)) add("pre_existing_hypertension_pregnancy", d.id, "first_line", 85, "acog2019", "First-line in pregnancy.");
    else if (d.id === "methyldopa") add("pre_existing_hypertension_pregnancy", d.id, "second_line", 65, "acog2019", "Long safety record; less effective, sedating.");
    else if (d.id === "hydralazine") add("pre_existing_hypertension_pregnancy", d.id, "special_population", 45, "acog2019", "Mostly acute severe HTN.");
    else add("pre_existing_hypertension_pregnancy", d.id, "add_on", 25, "acog2019", "Not preferred in pregnancy.");
  }
  return rows;
}

// ---------------------------------------------------------------------------
// TABLE 2: demographic / comorbidity / lab modifiers
// ---------------------------------------------------------------------------

export type Predicate =
  | { factor: "condition"; op: "has"; value: string }
  | { factor: "medication"; op: "has"; value: string }
  | { factor: "allergy"; op: "has"; value: string }
  | { factor: "ethnicity"; op: "is"; value: string }
  | { factor: "sex"; op: "is"; value: "MALE" | "FEMALE" }
  | { factor: "pregnancy"; op: "is"; value: "pregnant" | "childbearing_potential" | "breastfeeding" }
  | { factor: "age" | "bmi" | "egfr" | "potassium" | "sodium" | "uacr" | "heart_rate" | "bp_systolic"; op: ">=" | "<=" | ">" | "<"; value: number };

export type ModifierSeed = {
  target_type: "class" | "drug";
  target: string | string[];
  when: Predicate[];
  effect: "contraindicated" | "avoid" | "caution" | "neutral" | "prefer" | "strongly_prefer";
  delta: number;
  rationale: string;
  source: SourceKey;
  active?: boolean;
};

const c = (value: string): Predicate => ({ factor: "condition", op: "has", value });
const med = (value: string): Predicate => ({ factor: "medication", op: "has", value });

export const MODIFIERS: ModifierSeed[] = [
  // ---- Pregnancy / reproductive ----
  { target_type: "class", target: ["acei", "arb", "renin_inhibitor", "mra"], when: [{ factor: "pregnancy", op: "is", value: "pregnant" }], effect: "contraindicated", delta: -100, rationale: "Fetal toxicity (boxed warning for RAAS agents); MRAs also contraindicated in pregnancy per 2025 guideline.", source: "acc2025" },
  { target_type: "drug", target: "atenolol", when: [{ factor: "pregnancy", op: "is", value: "pregnant" }], effect: "contraindicated", delta: -100, rationale: "Atenolol is associated with fetal growth restriction; listed as contraindicated in 2025 guideline.", source: "acc2025" },
  { target_type: "class", target: ["acei", "arb", "renin_inhibitor"], when: [{ factor: "pregnancy", op: "is", value: "childbearing_potential" }], effect: "caution", delta: -15, rationale: "Teratogenic. Use only with reliable contraception and counselling.", source: "acc2025" },
  { target_type: "drug", target: ["labetalol", "nifedipine_er"], when: [{ factor: "pregnancy", op: "is", value: "pregnant" }], effect: "strongly_prefer", delta: 30, rationale: "First-line antihypertensives in pregnancy.", source: "acog2019" },
  { target_type: "drug", target: "methyldopa", when: [{ factor: "pregnancy", op: "is", value: "pregnant" }], effect: "prefer", delta: 15, rationale: "Long safety record in pregnancy.", source: "acog2019" },
  { target_type: "drug", target: ["labetalol", "nifedipine_er", "enalapril"], when: [{ factor: "pregnancy", op: "is", value: "breastfeeding" }], effect: "prefer", delta: 10, rationale: "Low milk transfer; considered compatible with breastfeeding.", source: "acog2019" },

  // ---- Diabetes / CKD / albuminuria ----
  { target_type: "class", target: ["acei", "arb"], when: [c("diabetes")], effect: "prefer", delta: 12, rationale: "Renal and CV protection in diabetes; strongest benefit with albuminuria.", source: "ada2025" },
  { target_type: "class", target: ["acei", "arb"], when: [{ factor: "uacr", op: ">=", value: 30 }], effect: "strongly_prefer", delta: 25, rationale: "Albuminuria ≥30 mg/g: ACEi/ARB slows CKD progression.", source: "kdigo2021" },
  { target_type: "class", target: ["acei", "arb"], when: [{ factor: "egfr", op: "<", value: 60 }], effect: "prefer", delta: 15, rationale: "CKD with eGFR <60: ACEi/ARB preferred (2025 guideline).", source: "acc2025" },
  { target_type: "class", target: ["acei", "arb"], when: [c("ckd")], effect: "prefer", delta: 10, rationale: "Documented CKD: RAAS blockade preferred.", source: "kdigo2021" },
  { target_type: "drug", target: "hydrochlorothiazide", when: [{ factor: "egfr", op: "<", value: 30 }], effect: "avoid", delta: -30, rationale: "HCTZ loses efficacy at eGFR <30.", source: "acc2017" },
  { target_type: "drug", target: "chlorthalidone", when: [{ factor: "egfr", op: "<", value: 30 }], effect: "caution", delta: -5, rationale: "Chlorthalidone still lowers BP in stage 4 CKD (CLICK) but watch electrolytes and eGFR.", source: "click" },
  { target_type: "class", target: "loop", when: [{ factor: "egfr", op: "<", value: 30 }], effect: "prefer", delta: 15, rationale: "Loop diuretics are effective diuretics at low eGFR.", source: "acc2017" },
  { target_type: "class", target: ["mra", "k_sparing"], when: [{ factor: "egfr", op: "<", value: 30 }], effect: "avoid", delta: -45, rationale: "High hyperkalemia risk at eGFR <30.", source: "fdaLabel" },
  { target_type: "drug", target: "eplerenone", when: [{ factor: "egfr", op: "<", value: 50 }], effect: "contraindicated", delta: -100, rationale: "Eplerenone label (hypertension): contraindicated with CrCl <50 mL/min.", source: "fdaLabel" },
  { target_type: "drug", target: "eplerenone", when: [c("diabetes"), { factor: "uacr", op: ">=", value: 30 }], effect: "contraindicated", delta: -100, rationale: "Eplerenone label (hypertension): contraindicated in type 2 diabetes with microalbuminuria.", source: "fdaLabel" },
  { target_type: "drug", target: "atenolol", when: [{ factor: "egfr", op: "<", value: 35 }], effect: "caution", delta: -15, rationale: "Renally cleared; needs dose reduction when CrCl <35.", source: "fdaLabel" },
  { target_type: "drug", target: "aliskiren", when: [c("diabetes"), med("acei")], effect: "contraindicated", delta: -100, rationale: "Aliskiren with ACEi/ARB is contraindicated in diabetes (label).", source: "fdaLabel" },
  { target_type: "drug", target: "aliskiren", when: [c("diabetes"), med("arb")], effect: "contraindicated", delta: -100, rationale: "Aliskiren with ACEi/ARB is contraindicated in diabetes (label).", source: "fdaLabel" },
  { target_type: "class", target: ["thiazide", "beta_blocker"], when: [c("diabetes")], effect: "caution", delta: -4, rationale: "Can worsen glycemia; nonselective β-blockers may mask hypoglycemia.", source: "acc2017" },

  // ---- Electrolytes ----
  { target_type: "class", target: ["acei", "arb", "renin_inhibitor"], when: [{ factor: "potassium", op: ">", value: 5.0 }], effect: "caution", delta: -25, rationale: "Baseline hyperkalemia; RAAS blockade raises K.", source: "fdaLabel" },
  { target_type: "class", target: ["mra", "k_sparing"], when: [{ factor: "potassium", op: ">", value: 5.0 }], effect: "contraindicated", delta: -100, rationale: "Contraindicated with serum K >5.0–5.5 mEq/L (label).", source: "fdaLabel" },
  { target_type: "class", target: ["mra", "k_sparing"], when: [{ factor: "potassium", op: "<", value: 3.5 }], effect: "prefer", delta: 10, rationale: "K-sparing agents correct hypokalemia.", source: "acc2017" },
  { target_type: "class", target: ["thiazide", "loop"], when: [{ factor: "potassium", op: "<", value: 3.5 }], effect: "caution", delta: -12, rationale: "Will worsen hypokalemia.", source: "fdaLabel" },
  { target_type: "class", target: "thiazide", when: [{ factor: "sodium", op: "<", value: 135 }], effect: "avoid", delta: -25, rationale: "Thiazides cause hyponatremia, especially in older women.", source: "fdaLabel" },
  { target_type: "class", target: "thiazide", when: [c("hyponatremia_history")], effect: "avoid", delta: -25, rationale: "History of thiazide-associated hyponatremia.", source: "fdaLabel" },
  { target_type: "class", target: ["mra", "k_sparing"], when: [med("potassium_supplement")], effect: "avoid", delta: -30, rationale: "Hyperkalemia risk with potassium supplements.", source: "fdaLabel" },

  // ---- Heart failure / CAD / arrhythmia ----
  { target_type: "drug", target: ["carvedilol", "metoprolol_succinate", "bisoprolol"], when: [c("hfref")], effect: "strongly_prefer", delta: 30, rationale: "Evidence-based β-blockers reduce mortality in HFrEF.", source: "hf2022" },
  { target_type: "class", target: ["acei", "arb"], when: [c("hfref")], effect: "strongly_prefer", delta: 22, rationale: "RAAS inhibition is GDMT for HFrEF.", source: "hf2022" },
  { target_type: "class", target: "mra", when: [c("hfref")], effect: "prefer", delta: 18, rationale: "MRA is GDMT for HFrEF (if eGFR >30, K <5.0).", source: "hf2022" },
  { target_type: "class", target: "ccb_nondhp", when: [c("hfref")], effect: "contraindicated", delta: -100, rationale: "Negative inotropes worsen HFrEF.", source: "hf2022" },
  { target_type: "drug", target: "nifedipine_er", when: [c("hfref")], effect: "avoid", delta: -30, rationale: "Only amlodipine/felodipine are neutral in HFrEF.", source: "hf2022" },
  { target_type: "class", target: ["alpha_blocker", "central_alpha"], when: [c("hfref")], effect: "avoid", delta: -30, rationale: "Doxazosin increased HF in ALLHAT; clonidine/moxonidine harmful in HF.", source: "allhat" },
  { target_type: "drug", target: "hydralazine", when: [c("hfref"), { factor: "ethnicity", op: "is", value: "black" }], effect: "prefer", delta: 15, rationale: "Hydralazine + isosorbide dinitrate reduces mortality in self-identified Black patients with HFrEF on GDMT (A-HeFT; Class 1).", source: "aheft" },
  { target_type: "class", target: ["mra", "thiazide", "loop"], when: [c("hfpef")], effect: "prefer", delta: 10, rationale: "Diuretics for congestion; spironolactone may reduce HF hospitalization (TOPCAT).", source: "topcat" },
  { target_type: "class", target: "beta_blocker", when: [c("cad")], effect: "prefer", delta: 15, rationale: "Anti-anginal; indicated in stable ischemic heart disease.", source: "acc2017" },
  { target_type: "class", target: "beta_blocker", when: [c("post_mi")], effect: "strongly_prefer", delta: 20, rationale: "β-blocker after MI.", source: "acc2017" },
  { target_type: "class", target: "acei", when: [c("post_mi")], effect: "prefer", delta: 12, rationale: "ACEi after MI, especially with reduced EF.", source: "acc2017" },
  { target_type: "class", target: "ccb_dhp", when: [c("angina")], effect: "prefer", delta: 8, rationale: "Anti-anginal effect.", source: "acc2017" },
  { target_type: "class", target: ["beta_blocker", "ccb_nondhp"], when: [c("afib")], effect: "prefer", delta: 15, rationale: "Rate control in atrial fibrillation.", source: "acc2017" },
  { target_type: "class", target: ["beta_blocker", "ccb_nondhp"], when: [{ factor: "heart_rate", op: "<", value: 55 }], effect: "avoid", delta: -45, rationale: "Bradycardia; further AV-nodal blockade is unsafe.", source: "fdaLabel" },
  { target_type: "class", target: ["beta_blocker", "ccb_nondhp"], when: [c("heart_block")], effect: "contraindicated", delta: -100, rationale: "Second/third-degree AV block without pacemaker (label contraindication).", source: "fdaLabel" },
  { target_type: "class", target: "ccb_nondhp", when: [med("beta_blocker")], effect: "avoid", delta: -40, rationale: "β-blocker + non-DHP CCB: bradycardia and heart block risk.", source: "acc2017" },
  { target_type: "class", target: "beta_blocker", when: [{ factor: "heart_rate", op: ">=", value: 90 }], effect: "prefer", delta: 6, rationale: "Elevated resting HR / hyperadrenergic state.", source: "acc2017" },
  { target_type: "drug", target: "atenolol", when: [{ factor: "age", op: ">=", value: 60 }], effect: "caution", delta: -12, rationale: "Atenolol inferior to other agents for stroke prevention in older adults (LIFE, ASCOT).", source: "acc2017" },

  // ---- Stroke / bone / gout / prostate ----
  { target_type: "class", target: ["thiazide", "acei"], when: [c("stroke_tia")], effect: "prefer", delta: 10, rationale: "Thiazide ± ACEi reduces recurrent stroke (PROGRESS).", source: "acc2017" },
  { target_type: "class", target: "thiazide", when: [c("osteoporosis")], effect: "prefer", delta: 6, rationale: "Thiazides reduce urinary calcium and may lower fracture risk.", source: "acc2017" },
  { target_type: "class", target: ["thiazide", "loop"], when: [c("gout")], effect: "avoid", delta: -25, rationale: "Diuretics raise uric acid and precipitate gout.", source: "acc2017" },
  { target_type: "drug", target: "losartan", when: [c("gout")], effect: "prefer", delta: 10, rationale: "Losartan is uricosuric.", source: "acc2017" },
  { target_type: "class", target: "ccb_dhp", when: [c("gout")], effect: "prefer", delta: 5, rationale: "Amlodipine lowers gout risk.", source: "acc2017" },
  { target_type: "class", target: "alpha_blocker", when: [c("bph")], effect: "prefer", delta: 15, rationale: "Also treats BPH symptoms (not as monotherapy for HTN).", source: "acc2017" },

  // ---- Lungs / vascular / other ----
  { target_type: "drug", target: ["propranolol_la", "carvedilol", "labetalol"], when: [c("asthma")], effect: "avoid", delta: -40, rationale: "Non-selective β-blockade can trigger bronchospasm.", source: "fdaLabel" },
  { target_type: "drug", target: ["metoprolol_succinate", "bisoprolol", "nebivolol", "atenolol"], when: [c("asthma")], effect: "caution", delta: -12, rationale: "Cardioselective β-blockers are generally tolerated but use caution in asthma.", source: "fdaLabel" },
  { target_type: "class", target: "beta_blocker", when: [c("copd")], effect: "caution", delta: -5, rationale: "Prefer cardioselective agents in COPD.", source: "acc2017" },
  { target_type: "class", target: "ccb_dhp", when: [c("raynaud")], effect: "prefer", delta: 8, rationale: "Vasodilation improves Raynaud phenomenon.", source: "acc2017" },
  { target_type: "class", target: "beta_blocker", when: [c("raynaud")], effect: "caution", delta: -8, rationale: "Can worsen peripheral vasospasm.", source: "acc2017" },
  { target_type: "drug", target: ["propranolol_la", "metoprolol_succinate"], when: [c("migraine")], effect: "prefer", delta: 8, rationale: "Migraine prophylaxis.", source: "acc2017" },
  { target_type: "drug", target: "propranolol_la", when: [c("essential_tremor")], effect: "prefer", delta: 10, rationale: "Treats essential tremor.", source: "acc2017" },
  { target_type: "class", target: "beta_blocker", when: [c("hyperthyroidism")], effect: "prefer", delta: 8, rationale: "Controls adrenergic symptoms.", source: "acc2017" },
  { target_type: "class", target: "ccb_dhp", when: [c("edema")], effect: "caution", delta: -10, rationale: "DHP CCBs cause dose-related peripheral edema.", source: "fdaLabel" },
  { target_type: "drug", target: ["labetalol", "methyldopa"], when: [c("liver_disease")], effect: "avoid", delta: -30, rationale: "Hepatotoxicity reported (label).", source: "fdaLabel" },
  { target_type: "drug", target: "methyldopa", when: [c("depression")], effect: "caution", delta: -10, rationale: "Can worsen depression.", source: "fdaLabel" },
  { target_type: "class", target: ["acei", "arb", "renin_inhibitor"], when: [c("bilateral_ras")], effect: "avoid", delta: -60, rationale: "Bilateral renal artery stenosis: risk of acute kidney injury.", source: "fdaLabel" },

  // ---- Angioedema / allergies ----
  { target_type: "class", target: "acei", when: [c("angioedema_history")], effect: "contraindicated", delta: -100, rationale: "History of angioedema (label contraindication).", source: "fdaLabel" },
  { target_type: "class", target: "arb", when: [c("angioedema_history")], effect: "caution", delta: -15, rationale: "Small cross-risk of angioedema with ARBs.", source: "fdaLabel" },
  { target_type: "class", target: "acei", when: [{ factor: "allergy", op: "has", value: "acei" }], effect: "contraindicated", delta: -100, rationale: "Documented ACE-inhibitor allergy.", source: "fdaLabel" },
  { target_type: "class", target: "arb", when: [{ factor: "allergy", op: "has", value: "arb" }], effect: "contraindicated", delta: -100, rationale: "Documented ARB allergy.", source: "fdaLabel" },
  { target_type: "class", target: "acei", when: [{ factor: "allergy", op: "has", value: "acei_cough" }], effect: "avoid", delta: -90, rationale: "Previous ACE-inhibitor cough is a class effect that usually recurs on rechallenge; use an ARB instead.", source: "acc2017" },
  { target_type: "class", target: ["thiazide", "loop"], when: [{ factor: "allergy", op: "has", value: "sulfa" }], effect: "caution", delta: -5, rationale: "Sulfonamide non-antibiotic; cross-reactivity is low but documented in labels.", source: "fdaLabel" },
  { target_type: "class", target: "acei", when: [med("sacubitril")], effect: "contraindicated", delta: -100, rationale: "ACEi within 36 h of sacubitril/valsartan: angioedema risk.", source: "fdaLabel" },

  // ---- Drug–drug interactions with current meds ----
  { target_type: "class", target: ["acei", "arb", "renin_inhibitor"], when: [med("acei")], effect: "avoid", delta: -50, rationale: "Dual RAAS blockade: more hyperkalemia/AKI with no benefit (ONTARGET, NEPHRON-D).", source: "ontarget" },
  { target_type: "class", target: ["acei", "arb", "renin_inhibitor"], when: [med("arb")], effect: "avoid", delta: -50, rationale: "Dual RAAS blockade: more hyperkalemia/AKI with no benefit (ONTARGET, NEPHRON-D).", source: "ontarget" },
  { target_type: "class", target: ["thiazide", "acei", "arb", "loop"], when: [med("lithium")], effect: "caution", delta: -20, rationale: "Raises lithium levels; toxicity risk (label).", source: "fdaLabel" },
  { target_type: "class", target: ["acei", "arb", "thiazide", "loop"], when: [med("nsaid")], effect: "caution", delta: -5, rationale: "NSAIDs blunt antihypertensive effect; 'triple whammy' AKI risk with ACEi/ARB + diuretic.", source: "fdaLabel" },
  { target_type: "drug", target: "verapamil_er", when: [med("digoxin")], effect: "caution", delta: -15, rationale: "Verapamil raises digoxin levels.", source: "fdaLabel" },
  { target_type: "class", target: "ccb_nondhp", when: [med("strong_cyp3a4_inhibitor")], effect: "caution", delta: -15, rationale: "CYP3A4 interactions.", source: "fdaLabel" },
  { target_type: "drug", target: "eplerenone", when: [med("strong_cyp3a4_inhibitor")], effect: "contraindicated", delta: -100, rationale: "Contraindicated with strong CYP3A4 inhibitors (label).", source: "fdaLabel" },

  // ---- Age / sex / body size ----
  { target_type: "class", target: ["alpha_blocker", "central_alpha"], when: [{ factor: "age", op: ">=", value: 65 }], effect: "avoid", delta: -25, rationale: "Beers 2023: avoid as antihypertensive in older adults (orthostasis, CNS effects).", source: "beers2023" },
  { target_type: "class", target: "alpha_blocker", when: [c("orthostatic_hypotension")], effect: "avoid", delta: -30, rationale: "Worsens orthostatic hypotension.", source: "beers2023" },
  { target_type: "class", target: ["thiazide", "ccb_dhp"], when: [{ factor: "age", op: ">=", value: 65 }], effect: "prefer", delta: 5, rationale: "Strong outcome data for isolated systolic HTN in older adults (SHEP, Syst-Eur).", source: "acc2017" },
  { target_type: "class", target: "thiazide", when: [{ factor: "age", op: ">=", value: 75 }, { factor: "sex", op: "is", value: "FEMALE" }], effect: "caution", delta: -6, rationale: "Higher hyponatremia risk in older women.", source: "fdaLabel" },
  { target_type: "drug", target: "spironolactone", when: [{ factor: "sex", op: "is", value: "MALE" }], effect: "caution", delta: -5, rationale: "Gynecomastia (~10%); eplerenone avoids this.", source: "fdaLabel" },
  { target_type: "class", target: "acei", when: [{ factor: "sex", op: "is", value: "FEMALE" }], effect: "caution", delta: -3, rationale: "ACE-inhibitor cough is roughly twice as common in women.", source: "aceiCough" },
  { target_type: "class", target: ["thiazide", "acei", "arb", "ccb_dhp"], when: [{ factor: "bmi", op: ">=", value: 30 }], effect: "neutral", delta: 0, rationale: "Obesity: no class preference; prioritise lifestyle/weight loss alongside therapy.", source: "acc2025" },
  { target_type: "class", target: "beta_blocker", when: [{ factor: "bmi", op: ">=", value: 30 }], effect: "caution", delta: -4, rationale: "Can cause modest weight gain and impair glucose metabolism (except carvedilol/nebivolol).", source: "acc2017" },

  // ---- Resistant HTN / aldosteronism ----
  { target_type: "drug", target: "spironolactone", when: [c("resistant_htn")], effect: "strongly_prefer", delta: 30, rationale: "Most effective fourth-line agent (PATHWAY-2).", source: "pathway2" },
  { target_type: "class", target: "mra", when: [c("primary_aldosteronism")], effect: "strongly_prefer", delta: 35, rationale: "Targeted therapy for aldosterone excess.", source: "acc2025" },

  // ---- Ethnicity / ancestry (pharmacologic safety differences, still current) ----
  { target_type: "class", target: "acei", when: [{ factor: "ethnicity", op: "is", value: "black" }], effect: "caution", delta: -8, rationale: "ACE-inhibitor angioedema is 3–4× more frequent in Black patients (FDA label; OCTAVE).", source: "aceiAngioedema" },
  { target_type: "class", target: "acei", when: [{ factor: "ethnicity", op: "is", value: "east_asian" }], effect: "caution", delta: -6, rationale: "Higher incidence of ACE-inhibitor cough in East Asian patients; ARB is an alternative.", source: "aceiCough" },
  // Superseded rule: kept for transparency, inactive by default.
  { target_type: "class", target: ["thiazide", "ccb_dhp"], when: [{ factor: "ethnicity", op: "is", value: "black" }], effect: "prefer", delta: 10, rationale: "LEGACY (2017 ACC/AHA): thiazide or CCB recommended as initial therapy in Black adults without HF/CKD. Removed in the 2025 guideline, which made first-line selection race-neutral.", source: "acc2017", active: false },
];
