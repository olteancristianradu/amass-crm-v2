import { LeadSource, RelationshipStatus } from '@prisma/client';

interface SampleContact {
  firstName: string;
  lastName: string;
  jobTitle: string;
  email: string;
  phone?: string;
  isDecider: boolean;
}

interface SampleCompany {
  name: string;
  vatNumber: string;
  industry: string;
  city: string;
  relationshipStatus: RelationshipStatus;
  leadSource: LeadSource;
  contacts: SampleContact[];
}

/**
 * 30 RO-flavored companies covering common SMB verticals (heating, IT,
 * retail, construction, logistics, professional services). Each has
 * 1-3 contacts. Total contacts: ~50. VAT numbers are formally valid
 * (8-digit Romanian CUI pattern) but obviously fake (RO99000001…).
 */
export const SAMPLE_COMPANIES: SampleCompany[] = [
  // ── Heating / HVAC vertical (matches AMASS context) ──
  { name: 'Termoland Instal SRL', vatNumber: 'RO99000001', industry: 'Instalații încălzire', city: 'Cluj-Napoca', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Mihai', lastName: 'Sandu', jobTitle: 'Director', email: 'mihai.sandu@termoland.ro', phone: '+40721000001', isDecider: true },
    { firstName: 'Ana', lastName: 'Voicu', jobTitle: 'Coordonator șantier', email: 'ana.voicu@termoland.ro', isDecider: false },
  ]},
  { name: 'CalorPro SA', vatNumber: 'RO99000002', industry: 'Instalații încălzire', city: 'București', relationshipStatus: 'PROSPECT', leadSource: 'WEB', contacts: [
    { firstName: 'Răzvan', lastName: 'Marin', jobTitle: 'CEO', email: 'razvan.marin@calorpro.ro', phone: '+40721000002', isDecider: true },
  ]},
  { name: 'EcoHeat Solutions', vatNumber: 'RO99000003', industry: 'Energie regenerabilă', city: 'Brașov', relationshipStatus: 'LEAD', leadSource: 'EVENT', contacts: [
    { firstName: 'Diana', lastName: 'Pop', jobTitle: 'Manager achiziții', email: 'diana.pop@ecoheat.ro', isDecider: true },
  ]},
  { name: 'Climatec Service', vatNumber: 'RO99000004', industry: 'Instalații HVAC', city: 'Timișoara', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Florin', lastName: 'Stanciu', jobTitle: 'Inginer service', email: 'florin.stanciu@climatec.ro', isDecider: false },
    { firstName: 'Bianca', lastName: 'Tudor', jobTitle: 'Director general', email: 'bianca.tudor@climatec.ro', isDecider: true },
  ]},
  { name: 'TermoElectric Plus', vatNumber: 'RO99000005', industry: 'Instalații electrice + încălzire', city: 'Iași', relationshipStatus: 'PROSPECT', leadSource: 'COLD_CALL', contacts: [
    { firstName: 'George', lastName: 'Cristea', jobTitle: 'Owner', email: 'george.cristea@termoelectric.ro', phone: '+40721000005', isDecider: true },
  ]},
  // ── IT services ──
  { name: 'NextWave IT SRL', vatNumber: 'RO99000006', industry: 'Tehnologie IT', city: 'Cluj-Napoca', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Andrei', lastName: 'Dobre', jobTitle: 'CTO', email: 'andrei.dobre@nextwave-it.ro', isDecider: true },
    { firstName: 'Cristina', lastName: 'Niță', jobTitle: 'Project Manager', email: 'cristina.nita@nextwave-it.ro', isDecider: false },
  ]},
  { name: 'CodeForge Studio', vatNumber: 'RO99000007', industry: 'Dezvoltare software', city: 'București', relationshipStatus: 'PROSPECT', leadSource: 'WEB', contacts: [
    { firstName: 'Vlad', lastName: 'Rusu', jobTitle: 'Founder', email: 'vlad.rusu@codeforge.ro', phone: '+40721000007', isDecider: true },
  ]},
  { name: 'CloudLink Romania', vatNumber: 'RO99000008', industry: 'Cloud services', city: 'Sibiu', relationshipStatus: 'LEAD', leadSource: 'EVENT', contacts: [
    { firstName: 'Mara', lastName: 'Petrescu', jobTitle: 'Sales Director', email: 'mara.petrescu@cloudlink.ro', isDecider: true },
  ]},
  // ── Retail / distribution ──
  { name: 'Distribuții Generale SA', vatNumber: 'RO99000009', industry: 'Distribuție FMCG', city: 'București', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Bogdan', lastName: 'Tomescu', jobTitle: 'Director comercial', email: 'bogdan.tomescu@distribgen.ro', phone: '+40721000009', isDecider: true },
  ]},
  { name: 'Magazin Universal Online', vatNumber: 'RO99000010', industry: 'E-commerce', city: 'Constanța', relationshipStatus: 'PROSPECT', leadSource: 'PARTNER', contacts: [
    { firstName: 'Ioana', lastName: 'Costea', jobTitle: 'Owner', email: 'ioana.costea@magonline.ro', isDecider: true },
    { firstName: 'Tudor', lastName: 'Vasilescu', jobTitle: 'Marketing', email: 'tudor.vasilescu@magonline.ro', isDecider: false },
  ]},
  // ── Construction ──
  { name: 'BuildMaster Construct SRL', vatNumber: 'RO99000011', industry: 'Construcții', city: 'București', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Cosmin', lastName: 'Ene', jobTitle: 'Director executiv', email: 'cosmin.ene@buildmaster.ro', phone: '+40721000011', isDecider: true },
  ]},
  { name: 'AlfaConstruct Group', vatNumber: 'RO99000012', industry: 'Construcții civile', city: 'Cluj-Napoca', relationshipStatus: 'PROSPECT', leadSource: 'WEB', contacts: [
    { firstName: 'Roxana', lastName: 'Iancu', jobTitle: 'CFO', email: 'roxana.iancu@alfaconstruct.ro', isDecider: true },
  ]},
  // ── Logistics ──
  { name: 'Transilvania Logistics', vatNumber: 'RO99000013', industry: 'Logistică & transport', city: 'Cluj-Napoca', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Dragoș', lastName: 'Manea', jobTitle: 'Operations Director', email: 'dragos.manea@translog.ro', isDecider: true },
  ]},
  { name: 'Speed Cargo SRL', vatNumber: 'RO99000014', industry: 'Curierat', city: 'București', relationshipStatus: 'PROSPECT', leadSource: 'COLD_CALL', contacts: [
    { firstName: 'Liviu', lastName: 'Albu', jobTitle: 'Manager flotă', email: 'liviu.albu@speedcargo.ro', isDecider: false },
  ]},
  // ── Professional services ──
  { name: 'ConsultingHub SRL', vatNumber: 'RO99000015', industry: 'Consultanță business', city: 'București', relationshipStatus: 'ACTIVE', leadSource: 'PARTNER', contacts: [
    { firstName: 'Adrian', lastName: 'Mihai', jobTitle: 'Managing Partner', email: 'adrian.mihai@consultinghub.ro', isDecider: true },
    { firstName: 'Ileana', lastName: 'Stoica', jobTitle: 'Senior Consultant', email: 'ileana.stoica@consultinghub.ro', isDecider: false },
  ]},
  { name: 'JuridicAvansat SCA', vatNumber: 'RO99000016', industry: 'Servicii juridice', city: 'București', relationshipStatus: 'PROSPECT', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Răzvan', lastName: 'Andrei', jobTitle: 'Avocat partner', email: 'razvan.andrei@juridicavansat.ro', isDecider: true },
  ]},
  { name: 'Contab Expert PFA', vatNumber: 'RO99000017', industry: 'Contabilitate', city: 'Sibiu', relationshipStatus: 'ACTIVE', leadSource: 'WEB', contacts: [
    { firstName: 'Camelia', lastName: 'Popa', jobTitle: 'Expert contabil', email: 'camelia.popa@contabexpert.ro', isDecider: true },
  ]},
  // ── Industrial ──
  { name: 'MetaLux Production SA', vatNumber: 'RO99000018', industry: 'Producție metalică', city: 'Pitești', relationshipStatus: 'PROSPECT', leadSource: 'EVENT', contacts: [
    { firstName: 'Marian', lastName: 'Olteanu', jobTitle: 'Director producție', email: 'marian.olteanu@metalux.ro', phone: '+40721000018', isDecider: true },
  ]},
  { name: 'PlastIndustry SRL', vatNumber: 'RO99000019', industry: 'Producție mase plastice', city: 'Brașov', relationshipStatus: 'LEAD', leadSource: 'COLD_CALL', contacts: [
    { firstName: 'Sorin', lastName: 'Toma', jobTitle: 'Sales Manager', email: 'sorin.toma@plastindustry.ro', isDecider: true },
  ]},
  // ── Healthcare adjacent ──
  { name: 'MediCare Plus Clinic', vatNumber: 'RO99000020', industry: 'Servicii medicale', city: 'Cluj-Napoca', relationshipStatus: 'ACTIVE', leadSource: 'PARTNER', contacts: [
    { firstName: 'Dana', lastName: 'Florescu', jobTitle: 'Director administrativ', email: 'dana.florescu@medicare-plus.ro', isDecider: true },
  ]},
  // ── Education / training ──
  { name: 'EduTech Academy', vatNumber: 'RO99000021', industry: 'Educație tech', city: 'București', relationshipStatus: 'PROSPECT', leadSource: 'WEB', contacts: [
    { firstName: 'Alex', lastName: 'Diaconu', jobTitle: 'CEO', email: 'alex.diaconu@edutech.ro', isDecider: true },
    { firstName: 'Monica', lastName: 'Bălan', jobTitle: 'Head of Sales', email: 'monica.balan@edutech.ro', isDecider: false },
  ]},
  // ── Marketing ──
  { name: 'BrandUp Agency', vatNumber: 'RO99000022', industry: 'Marketing & PR', city: 'București', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Lucian', lastName: 'Dumitru', jobTitle: 'Creative Director', email: 'lucian.dumitru@brandup.ro', isDecider: true },
  ]},
  { name: 'ClickWise Digital', vatNumber: 'RO99000023', industry: 'Digital marketing', city: 'Cluj-Napoca', relationshipStatus: 'PROSPECT', leadSource: 'EVENT', contacts: [
    { firstName: 'Andra', lastName: 'Ene', jobTitle: 'Account Manager', email: 'andra.ene@clickwise.ro', isDecider: false },
  ]},
  // ── Energy ──
  { name: 'GreenPower Solar', vatNumber: 'RO99000024', industry: 'Panouri fotovoltaice', city: 'Constanța', relationshipStatus: 'ACTIVE', leadSource: 'WEB', contacts: [
    { firstName: 'Robert', lastName: 'Soare', jobTitle: 'Owner', email: 'robert.soare@greenpower.ro', phone: '+40721000024', isDecider: true },
  ]},
  // ── Hospitality ──
  { name: 'Hotel Prestige Brașov', vatNumber: 'RO99000025', industry: 'Ospitalitate', city: 'Brașov', relationshipStatus: 'PROSPECT', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Eugenia', lastName: 'Mateescu', jobTitle: 'Director hotel', email: 'eugenia.mateescu@hotelprestige.ro', isDecider: true },
  ]},
  // ── Real estate ──
  { name: 'EliteRealty Cluj', vatNumber: 'RO99000026', industry: 'Imobiliare', city: 'Cluj-Napoca', relationshipStatus: 'LEAD', leadSource: 'COLD_CALL', contacts: [
    { firstName: 'Cristina', lastName: 'Vlad', jobTitle: 'Broker manager', email: 'cristina.vlad@eliterealty.ro', isDecider: true },
  ]},
  // ── Food ──
  { name: 'Gusturi de Acasă SRL', vatNumber: 'RO99000027', industry: 'Producție alimentară', city: 'Sibiu', relationshipStatus: 'PROSPECT', leadSource: 'EVENT', contacts: [
    { firstName: 'Petru', lastName: 'Ioniță', jobTitle: 'Owner', email: 'petru.ionita@gusturideacasa.ro', isDecider: true },
    { firstName: 'Larisa', lastName: 'Crăciun', jobTitle: 'Sales rep', email: 'larisa.craciun@gusturideacasa.ro', isDecider: false },
  ]},
  // ── Auto ──
  { name: 'Service Auto Complet', vatNumber: 'RO99000028', industry: 'Service auto', city: 'București', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Mihaela', lastName: 'Banu', jobTitle: 'Director comercial', email: 'mihaela.banu@serviceauto.ro', isDecider: true },
  ]},
  // ── Architecture ──
  { name: 'ArhiDesign Studio', vatNumber: 'RO99000029', industry: 'Arhitectură & design', city: 'Cluj-Napoca', relationshipStatus: 'PROSPECT', leadSource: 'WEB', contacts: [
    { firstName: 'Ștefan', lastName: 'Munteanu', jobTitle: 'Arhitect principal', email: 'stefan.munteanu@arhidesign.ro', isDecider: true },
  ]},
  // ── Retail specialty ──
  { name: 'Atelier Mobilă Custom', vatNumber: 'RO99000030', industry: 'Mobilier la comandă', city: 'Timișoara', relationshipStatus: 'ACTIVE', leadSource: 'REFERRAL', contacts: [
    { firstName: 'Cristian', lastName: 'Tăbăcaru', jobTitle: 'Owner', email: 'cristian.tabacaru@ateliermobila.ro', phone: '+40721000030', isDecider: true },
  ]},
];

interface SampleDealSpec {
  title: string;
  value: number;
  companyIndex: number;
  outcome: 'open' | 'won' | 'lost';
}

export const SAMPLE_DEAL_TITLES: SampleDealSpec[] = [
  { title: 'Sistem încălzire pardoseală 200mp birouri', value: 18500, companyIndex: 0, outcome: 'open' },
  { title: 'Radiatoare rocă vulcanică showroom', value: 7200, companyIndex: 2, outcome: 'won' },
  { title: 'Modernizare HVAC clădire administrativă', value: 42000, companyIndex: 3, outcome: 'open' },
  { title: 'Implementare ERP modul vânzări', value: 28000, companyIndex: 5, outcome: 'open' },
  { title: 'Migrare cloud + 12 luni mentenanță', value: 36500, companyIndex: 7, outcome: 'won' },
  { title: 'Distribuție produse zona Moldovei', value: 15000, companyIndex: 8, outcome: 'open' },
  { title: 'Refurbish 3 locații retail', value: 95000, companyIndex: 10, outcome: 'open' },
  { title: 'Servicii curierat lunare 6 luni', value: 4800, companyIndex: 13, outcome: 'lost' },
  { title: 'Consultanță restructurare comercială Q3', value: 21000, companyIndex: 14, outcome: 'open' },
  { title: 'Pachet juridic anual entitate SRL', value: 8400, companyIndex: 15, outcome: 'won' },
  { title: 'Producție 500 piese custom inox', value: 32000, companyIndex: 17, outcome: 'open' },
  { title: 'Contract clinică medicală: cabinete climatizare', value: 12500, companyIndex: 19, outcome: 'open' },
  { title: 'Curs intensiv React 30 dezvoltatori', value: 18000, companyIndex: 20, outcome: 'won' },
  { title: 'Campanie rebranding + landing pages', value: 14500, companyIndex: 21, outcome: 'open' },
  { title: 'Instalație fotovoltaică 50kW comercial', value: 110000, companyIndex: 23, outcome: 'open' },
  { title: 'Renovare bucătărie hotel + bar', value: 78000, companyIndex: 24, outcome: 'lost' },
  { title: 'Imobil rezidențial Cluj — vânzare', value: 245000, companyIndex: 25, outcome: 'open' },
  { title: 'Aprovizionare produse delicatese Q4', value: 9200, companyIndex: 26, outcome: 'won' },
  { title: 'Service flotă 15 vehicule abonament', value: 11800, companyIndex: 27, outcome: 'open' },
  { title: 'Proiect arhitectural locuință 220mp', value: 24500, companyIndex: 28, outcome: 'open' },
];
