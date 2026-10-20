/**
 * Named places inside the zones: the towns, crossings, ports, bases and
 * facilities where activity in a zone actually happens. They appear on the
 * globe as the camera closes in, and light up when a live headline names them.
 *
 * Notes are background context as of the dataset review, not live status:
 * front lines and control change faster than this file. Coordinates are
 * WGS84, lat-first; towns were checked against GeoNames (see scripts/check-sites.mjs).
 *
 * Zone nodes (HeatZone.nodes) are added automatically by `zoneSites`, so a
 * facility listed there does not need repeating here.
 */
import type { HeatZone, LatLng } from "./schema";

export type SiteKind = "front" | "city" | "capital" | "port" | "base" | "nuclear" | "energy" | "crossing" | "camp" | "sea" | "node";

export type Site = {
  id: string;
  zoneId: string;
  name: string;
  coord: LatLng;
  kind: SiteKind;
  note: string;
  /** Other spellings matched against headlines. `name` always matches unless `match` is false. */
  aka?: string[];
  /** false for names too generic to match against headlines. */
  match?: boolean;
  /** Among the few places that define the zone; labelled ahead of neighbours when space is short. */
  key?: boolean;
};

type Row = [name: string, lat: number, lng: number, kind: SiteKind, note: string, aka?: string[]];

const SITES: Record<string, Row[]> = {
  "ukraine-front": [
    ["Kyiv", 50.45, 30.524, "capital", "Capital; the main target of Russian missile and drone salvos on the power grid.", ["Kiev"]],
    ["Kharkiv", 49.994, 36.231, "city", "Second city, about 30 km from the Russian border; routinely hit by glide bombs and drones.", ["Kharkov"]],
    ["Sumy", 50.907, 34.798, "city", "Border oblast capital; target of Russian cross-border pushes since 2025."],
    ["Vovchansk", 50.291, 36.941, "front", "Border town north-east of Kharkiv; on the front since the May 2024 incursion."],
    ["Kupiansk", 49.71, 37.616, "front", "Rail junction on the Oskil River; repeatedly contested.", ["Kupyansk"]],
    ["Lyman", 48.989, 37.802, "front", "Rail hub in northern Donetsk oblast on the axis toward Sloviansk."],
    ["Siversk", 48.867, 38.1, "front", "Northern Donetsk front town."],
    ["Chasiv Yar", 48.586, 37.836, "front", "Heights west of Bakhmut; fought over through 2024–25."],
    ["Bakhmut", 48.595, 38.0, "front", "Taken by Russian forces in May 2023 after a ten-month battle.", ["Artemivsk"]],
    ["Toretsk", 48.398, 37.847, "front", "Donetsk front town south of Bakhmut."],
    ["Kostiantynivka", 48.527, 37.707, "front", "Southern gate of the Sloviansk–Kramatorsk fortress belt.", ["Konstantinovka"]],
    ["Kramatorsk", 48.723, 37.556, "city", "Part of the Sloviansk–Kramatorsk belt, Ukraine's main stronghold in Donetsk oblast."],
    ["Sloviansk", 48.852, 37.604, "city", "Northern anchor of the Donetsk fortress belt.", ["Slovyansk"]],
    ["Pokrovsk", 48.282, 37.176, "front", "Road and rail hub; focus of Russia's main offensive in 2024–25."],
    ["Myrnohrad", 48.302, 37.265, "front", "Twin town of Pokrovsk.", ["Dimitrov"]],
    ["Avdiivka", 48.139, 37.742, "front", "Taken by Russian forces in February 2024."],
    ["Donetsk", 48.023, 37.802, "city", "Regional capital held by Russian-backed forces since 2014."],
    ["Kurakhove", 47.984, 37.281, "front", "Taken by Russian forces in early 2025."],
    ["Huliaipole", 47.664, 36.257, "front", "Zaporizhzhia-front town; a focus of Russian advances from late 2025.", ["Gulyaipole"]],
    ["Orikhiv", 47.567, 35.785, "front", "Southern front on the approach to Zaporizhzhia city."],
    ["Zaporizhzhia", 47.838, 35.139, "city", "Regional capital a few dozen kilometres behind the southern front."],
    ["Zaporizhzhia NPP", 47.512, 34.586, "nuclear", "Europe's largest nuclear plant, at Enerhodar; Russian-held since March 2022, with IAEA staff on site.", ["Enerhodar", "Zaporizhzhia nuclear"]],
    ["Dnipro", 48.464, 35.046, "city", "Logistics and hospital hub behind the eastern front."],
    ["Kherson", 46.636, 32.617, "city", "Retaken by Ukraine in November 2022; shelled from the Russian-held left bank of the Dnipro."],
    ["Nova Kakhovka", 46.755, 33.348, "front", "Left-bank town at the dam destroyed in June 2023.", ["Kakhovka"]],
    ["Mariupol", 47.097, 37.543, "city", "Occupied since May 2022 after the siege of Azovstal."],
    ["Sevastopol", 44.617, 33.525, "base", "Black Sea Fleet main base; hit repeatedly by Ukrainian missiles and sea drones."],
    ["Kerch Bridge", 45.305, 36.511, "crossing", "Road and rail bridge to Crimea; struck in 2022 and 2023.", ["Crimean Bridge"]],
    ["Belgorod", 50.597, 36.585, "city", "Russian border city; staging area and target of Ukrainian drones and shelling."],
    ["Sudzha", 51.19, 35.27, "front", "Kursk-oblast gas-metering town held by Ukraine from August 2024 to March 2025."],
    ["Tuapse", 44.1, 39.077, "energy", "Black Sea refinery and export port; a recurring Ukrainian drone target."],
    ["Engels air base", 51.481, 46.2, "base", "Strategic-bomber base near Saratov; struck by long-range drones.", ["Engels"]],
  ],
  "gaza-lebanon-israel": [
    ["Gaza City", 31.502, 34.467, "city", "Largest city of the Strip; site of major ground operations 2023–25."],
    ["Jabalia", 31.528, 34.483, "camp", "Refugee camp north of Gaza City; repeatedly besieged.", ["Jabaliya"]],
    ["Beit Hanoun", 31.539, 34.536, "front", "North-east corner of the Strip, against the border fence."],
    ["Deir al-Balah", 31.418, 34.351, "city", "Central Gaza; humanitarian hub during the war.", ["Deir el-Balah"]],
    ["Khan Younis", 31.346, 34.306, "city", "Southern city; site of the 2024 Nasser hospital operations.", ["Khan Yunis"]],
    ["Rafah", 31.297, 34.245, "crossing", "Southern city on the Egyptian border and the Rafah crossing."],
    ["Kerem Shalom", 31.227, 34.284, "crossing", "Main goods crossing into Gaza."],
    ["Sderot", 31.525, 34.596, "city", "Israeli town beside the Gaza fence."],
    ["Tel Aviv", 32.085, 34.782, "city", "Target of Iranian missile salvos in 2024 and 2026."],
    ["Haifa", 32.794, 34.99, "port", "Port, refinery and naval base; within Hezbollah rocket range."],
    ["Kiryat Shmona", 33.208, 35.571, "front", "Northern border town evacuated under Hezbollah fire."],
    ["Metula", 33.279, 35.58, "front", "Northernmost Israeli town, on the Lebanese border."],
    ["Dahiyeh", 33.853, 35.51, "city", "Hezbollah's stronghold in Beirut's southern suburbs; repeatedly struck.", ["Dahieh", "Dahiya"]],
    ["Tyre", 33.271, 35.196, "city", "Southern Lebanese coastal city south of the Litani.", ["Sour"]],
    ["Nabatieh", 33.378, 35.484, "city", "Market town in south Lebanon; a Hezbollah centre.", ["Nabatiyeh"]],
    ["Bint Jbeil", 33.12, 35.433, "front", "Border town in south Lebanon; scene of ground fighting."],
    ["Khiam", 33.33, 35.613, "front", "Border town overlooking the Galilee panhandle."],
    ["Litani River", 33.339, 35.248, "front", "Line in UNSC 1701 south of which Hezbollah is to be disarmed; bridges cut in 2026.", ["Litani"]],
    ["Baalbek", 34.006, 36.211, "city", "Bekaa Valley; Hezbollah logistics heartland, struck repeatedly."],
    ["Jenin", 32.461, 35.3, "camp", "Northern West Bank camp; Israeli operations since 2025."],
    ["Tulkarm", 32.311, 35.028, "camp", "Northern West Bank camps emptied by 2025 operations.", ["Tulkarem"]],
    ["Jerusalem", 31.778, 35.225, "city", "Seat of government; flashpoint around the holy sites."],
  ],
  "lebanon-state": [
    ["Beirut", 33.894, 35.502, "capital", "Capital; seat of a government under pressure to monopolise arms."],
    ["Port of Beirut", 33.902, 35.518, "port", "Site of the August 2020 explosion; main import gateway."],
    ["Beirut airport", 33.821, 35.488, "base", "Rafic Hariri International; scrutinised for Hezbollah supply.", ["Rafic Hariri"]],
    ["Sidon", 33.563, 35.368, "city", "Southern coastal city north of the Litani.", ["Saida"]],
    ["Tripoli", 34.437, 35.83, "city", "Northern port city; Sunni political centre."],
  ],
  "red-sea-houthis": [
    ["Hodeidah", 14.798, 42.954, "port", "Houthis' main Red Sea port; struck by Israel and the US.", ["Hudaydah", "Hodeida"]],
    ["Ras Isa", 15.12, 42.62, "energy", "Fuel import terminal north of Hodeidah; struck by the US in April 2025.", ["Ras Issa"]],
    ["Salif", 15.306, 42.677, "port", "Northern Houthi-held port."],
    ["Sanaa", 15.354, 44.207, "capital", "Houthi-held capital; struck by Israel and the US.", ["Sana'a", "Sanaʽa"]],
    ["Saada", 16.94, 43.764, "city", "Houthi heartland on the Saudi border.", ["Sa'dah", "Saadah"]],
    ["Mokha", 13.32, 43.25, "front", "Red Sea coastal town taken by the Houthis in September 2026 (conf: med).", ["Mocha", "Al Mukha"]],
    ["Kamaran Island", 15.34, 42.6, "port", "Island off the Houthi-held coast.", ["Kamaran"]],
    ["Yanbu", 24.089, 38.064, "energy", "Saudi Red Sea export port at the end of the East–West pipeline; the Gulf's bypass while Hormuz is shut."],
    ["Eilat", 29.557, 34.952, "port", "Israel's Red Sea port; traffic collapsed under the Houthi blockade."],
  ],
  "yemen-residual": [
    ["Aden", 12.785, 45.018, "capital", "Seat of the internationally recognised government."],
    ["Marib", 15.463, 45.325, "city", "Government-held oil and gas hub, long a Houthi objective.", ["Ma'rib"]],
    ["Taiz", 13.58, 44.021, "front", "Divided city under Houthi siege for years.", ["Ta'izz"]],
    ["Mukalla", 14.542, 49.124, "port", "Hadramawt's capital and port."],
    ["Ataq", 14.535, 46.831, "city", "Shabwah governorate seat; oil region."],
  ],
  sudan: [
    ["Khartoum", 15.501, 32.56, "capital", "Capital; retaken by the army (SAF) in March 2025 after two years of fighting."],
    ["Omdurman", 15.645, 32.478, "city", "Twin city across the Nile; front line through 2024."],
    ["Port Sudan", 19.616, 37.216, "port", "SAF-aligned government's seat and main port; hit by RSF drones from May 2025."],
    ["El Fasher", 13.628, 25.35, "city", "North Darfur capital; fell to the RSF in October 2025 after an 18-month siege.", ["Al Fashir", "El-Fasher", "Al-Fashir"]],
    ["Zamzam camp", 13.47, 25.3, "camp", "Displacement camp south of El Fasher overrun by the RSF in April 2025.", ["Zamzam"]],
    ["Nyala", 12.052, 24.881, "city", "South Darfur capital; the RSF's main base and drone hub."],
    ["El Geneina", 13.453, 22.448, "city", "West Darfur capital; scene of mass killings in 2023.", ["Geneina"]],
    ["Adre crossing", 13.466, 22.196, "crossing", "Main aid crossing from Chad into Darfur.", ["Adre"]],
    ["El Obeid", 13.184, 30.217, "front", "North Kordofan capital and rail hub; RSF offensive objective.", ["Al-Ubayyid", "El-Obeid"]],
    ["Babanusa", 11.333, 27.814, "front", "West Kordofan rail town; long contested."],
    ["En Nahud", 12.694, 28.434, "front", "West Kordofan town taken by the RSF in 2025.", ["Al Nuhud"]],
    ["Dilling", 12.05, 29.65, "front", "South Kordofan town under siege."],
    ["Kadugli", 11.011, 29.718, "front", "South Kordofan capital; besieged and struck by drones."],
    ["Wad Madani", 14.402, 33.519, "city", "Gezira state capital; retaken by SAF in January 2025.", ["Wad Medani"]],
  ],
  myanmar: [
    ["Naypyidaw", 19.745, 96.129, "capital", "Military-built capital.", ["Naypyitaw", "Nay Pyi Taw"]],
    ["Mandalay", 21.975, 96.083, "city", "Second city; hit hard by the March 2025 earthquake."],
    ["Sagaing", 21.878, 95.978, "front", "Resistance heartland of the dry zone; heavy junta airstrikes."],
    ["Lashio", 22.937, 97.75, "city", "Northern Shan hub; taken by the MNDAA in 2024 and returned to the junta in 2025 under Chinese pressure."],
    ["Myitkyina", 25.383, 97.396, "city", "Kachin state capital."],
    ["Bhamo", 24.258, 97.232, "front", "Irrawaddy town besieged by the Kachin Independence Army."],
    ["Sittwe", 20.146, 92.897, "front", "Rakhine capital, one of the last junta holds in the state."],
    ["Kyaukphyu", 19.429, 93.549, "port", "Chinese deep-sea port and pipeline terminus; Arakan Army objective."],
    ["Myawaddy", 16.689, 98.509, "crossing", "Thai-border trade hub and scam-compound centre."],
    ["Muse", 23.993, 97.903, "crossing", "Main border crossing to China."],
  ],
  "drc-east": [
    ["Goma", -1.679, 29.222, "city", "North Kivu capital; taken by M23 in January 2025."],
    ["Bukavu", -2.508, 28.861, "city", "South Kivu capital; taken by M23 in February 2025."],
    ["Rubaya", -1.557, 28.882, "energy", "Coltan-mining town under M23 control since 2024."],
    ["Uvira", -3.395, 29.138, "front", "Lake Tanganyika port on the Burundi border; M23 advance axis."],
    ["Walikale", -1.417, 28.05, "front", "Tin-mining territory; M23 advance in March 2025."],
    ["Beni", 0.491, 29.473, "front", "ADF attack zone in northern North Kivu."],
    ["Bunia", 1.566, 30.252, "city", "Ituri capital; militia violence."],
    ["Kigali", -1.95, 30.059, "capital", "Rwandan capital; UN experts say Rwanda backs M23."],
  ],
  "sahel-central": [
    ["Bamako", 12.639, -8.003, "capital", "Mali's capital; JNIM's 2025 fuel blockade targeted its supply roads."],
    ["Ouagadougou", 12.371, -1.52, "capital", "Burkina Faso's capital."],
    ["Niamey", 13.514, 2.113, "capital", "Niger's capital."],
    ["Djibo", 14.102, -1.627, "front", "Besieged northern Burkina town; major JNIM attack in May 2025."],
    ["Menaka", 15.918, 2.402, "front", "Eastern Mali; IS-Sahel stronghold region.", ["Ménaka"]],
    ["Gao", 16.272, -0.044, "city", "Northern Mali garrison city on the Niger."],
    ["Timbuktu", 16.773, -3.007, "city", "Blockaded by JNIM in 2023–24.", ["Tombouctou"]],
    ["Kayes", 14.448, -11.445, "city", "Western Mali; JNIM attacks reached here in July 2025."],
    ["Tillaberi", 14.207, 1.453, "front", "Niger's tri-border region; repeated massacres.", ["Tillabéri"]],
    ["Fada N'Gourma", 12.062, 0.358, "city", "Eastern Burkina; JNIM operating area."],
  ],
  "lake-chad": [
    ["Maiduguri", 11.846, 13.16, "city", "Borno state capital and garrison hub."],
    ["Monguno", 12.67, 13.612, "base", "Multinational Joint Task Force sector headquarters."],
    ["Baga", 13.113, 13.832, "front", "Lakeshore town in an ISWAP stronghold area."],
    ["Marte", 12.366, 13.826, "front", "Borno garrison town attacked repeatedly by ISWAP."],
    ["Diffa", 13.316, 12.611, "city", "Niger's Lake Chad region."],
    ["Bol", 13.459, 14.714, "city", "Chad's lake province capital."],
    ["Mora", 11.046, 14.14, "front", "Cameroon Far North; Boko Haram raids."],
  ],
  haiti: [
    ["Port-au-Prince", 18.544, -72.339, "capital", "Capital; most of the city under gang control."],
    ["Toussaint Louverture Airport", 18.58, -72.293, "base", "Main airport; closed by gang fire in 2024.", ["Port-au-Prince airport"]],
    ["Varreux fuel terminal", 18.57, -72.32, "energy", "Main fuel terminal; periodically blockaded.", ["Varreux"]],
    ["Cité Soleil", 18.58, -72.333, "front", "Gang-held district by the port.", ["Cite Soleil"]],
    ["Mirebalais", 18.834, -72.105, "front", "Centre department town overrun by gangs in March 2025."],
    ["Pont-Sondé", 19.15, -72.61, "front", "Artibonite town; site of the October 2024 Gran Grif massacre.", ["Pont-Sonde"]],
    ["Kenscoff", 18.451, -72.287, "front", "Hills above the capital; gang offensives in 2025."],
    ["Cap-Haïtien", 19.758, -72.204, "city", "Northern port; alternative gateway.", ["Cap-Haitien"]],
  ],
  "syria-transition": [
    ["Damascus", 33.513, 36.292, "capital", "Capital of the post-Assad government."],
    ["Aleppo", 36.202, 37.155, "city", "Northern city; Kurdish districts tied to SDF integration."],
    ["Homs", 34.731, 36.709, "city", "Central crossroads city."],
    ["Latakia", 35.517, 35.783, "city", "Alawite coast; March 2025 sectarian massacres."],
    ["Tartus", 34.889, 35.887, "port", "Russian naval facility; lease under renegotiation."],
    ["Hmeimim air base", 35.401, 35.949, "base", "Russian air base near Latakia.", ["Hmeimim", "Khmeimim"]],
    ["Sweida", 32.709, 36.566, "city", "Druze city; July 2025 clashes drew Israeli strikes.", ["Suwayda", "As-Suwayda"]],
    ["Quneitra", 33.126, 35.824, "front", "Golan buffer zone occupied by Israel since December 2024."],
    ["Mount Hermon", 33.416, 35.857, "base", "Syrian-side summit held by Israel since December 2024.", ["Jabal al-Sheikh", "Hermon"]],
    ["Raqqa", 35.95, 39.009, "city", "Former ISIS capital; SDF-administered.", ["Al-Raqqah"]],
    ["Deir ez-Zor", 35.336, 40.141, "city", "Euphrates city beside the eastern oilfields.", ["Deir ez-Zor", "Deir al-Zor"]],
    ["Qamishli", 37.052, 41.227, "city", "Kurdish-led northeast's main city."],
    ["al-Hol camp", 36.373, 41.149, "camp", "Camp holding ISIS-linked families.", ["al-Hol", "Al Hol"]],
  ],
  "korea-dmz": [
    ["Panmunjom", 37.956, 126.677, "crossing", "Joint Security Area inside the DMZ.", ["JSA"]],
    ["Kaesong", 37.971, 126.554, "city", "North Korean border city; site of the demolished liaison office."],
    ["Yeonpyeong Island", 37.666, 125.7, "base", "South Korean island near the NLL; shelled in 2010.", ["Yeonpyeong"]],
    ["Baengnyeong Island", 37.96, 124.664, "base", "Northernmost South Korean island.", ["Baengnyeong"]],
    ["Seoul", 37.566, 126.978, "capital", "Capital within artillery range of the DMZ."],
    ["Pyongyang", 39.039, 125.762, "capital", "North Korean capital."],
    ["Cheorwon", 38.209, 127.218, "front", "Central DMZ sector."],
  ],
  "taiwan-strait": [
    ["Taipei", 25.033, 121.565, "capital", "Capital."],
    ["Kinmen", 24.436, 118.318, "base", "Taiwan-held islands a few km off Xiamen; coast-guard encounters.", ["Quemoy"]],
    ["Matsu", 26.16, 119.95, "base", "Taiwan-held islands off Fuzhou; undersea cables cut in 2023."],
    ["Penghu", 23.569, 119.579, "base", "Island group mid-strait; air and naval base.", ["Pescadores"]],
    ["Xiamen", 24.48, 118.089, "city", "Mainland city facing Kinmen."],
    ["Pingtan", 25.498, 119.79, "base", "Closest mainland point to Taiwan; PLA exercise staging."],
    ["Kaohsiung", 22.627, 120.301, "port", "Main port and naval base in the south."],
    ["Hualien", 23.976, 121.604, "base", "East-coast air base, sheltered by the mountains."],
    ["Pratas Island", 20.7, 116.72, "base", "Taiwan-held atoll in the northern South China Sea.", ["Pratas", "Dongsha"]],
  ],
  "south-china-sea": [
    ["Mischief Reef", 9.9, 115.535, "base", "Chinese-built island base in the Spratlys."],
    ["Fiery Cross Reef", 9.55, 112.89, "base", "Chinese-built island with a 3 km runway."],
    ["Subi Reef", 10.923, 114.084, "base", "Chinese-built island base near Thitu."],
    ["Thitu Island", 11.052, 114.284, "base", "Philippine-held island.", ["Pag-asa"]],
    ["Sabina Shoal", 9.75, 116.47, "sea", "Philippine coast-guard stand-offs in 2024.", ["Escoda Shoal"]],
    ["Sanya", 18.253, 109.512, "base", "Hainan; PLA Navy submarine base at Yulin."],
    ["Cam Ranh Bay", 11.95, 109.2, "port", "Vietnamese naval port.", ["Cam Ranh"]],
    ["Subic Bay", 14.8, 120.27, "port", "Philippine port and former US base."],
  ],
  "east-china-sea": [
    ["Senkaku Islands", 25.745, 123.47, "sea", "Japanese-administered, claimed by China; near-constant coast-guard presence.", ["Senkaku", "Diaoyu"]],
    ["Yonaguni", 24.467, 123.0, "base", "Westernmost Japanese island, 110 km from Taiwan; JSDF post."],
    ["Ishigaki", 24.34, 124.156, "base", "Japanese island with a missile unit."],
    ["Ningbo", 29.868, 121.544, "base", "PLA Navy Eastern Theater fleet headquarters."],
  ],
  "kashmir-loc": [
    ["Srinagar", 34.084, 74.797, "city", "Capital of Indian-administered Kashmir."],
    ["Pahalgam", 34.016, 75.315, "front", "April 2025 attack on tourists that triggered the May 2025 strikes."],
    ["Poonch", 33.773, 74.093, "front", "LoC town shelled heavily in May 2025."],
    ["Uri", 34.083, 74.033, "front", "LoC sector on the Jhelum."],
    ["Muzaffarabad", 34.37, 73.471, "city", "Capital of Pakistan-administered Kashmir; struck in May 2025."],
    ["Muridke", 31.802, 74.26, "base", "Lashkar-e-Taiba headquarters complex struck by India in May 2025."],
    ["Bahawalpur", 29.395, 71.683, "base", "Jaish-e-Mohammed centre struck by India in May 2025."],
    ["Nur Khan air base", 33.616, 73.1, "base", "Rawalpindi air base struck by India in May 2025.", ["Nur Khan"]],
  ],
  "armenia-azerbaijan": [
    ["Yerevan", 40.177, 44.513, "capital", "Armenian capital."],
    ["Baku", 40.409, 49.867, "capital", "Azerbaijani capital."],
    ["Khankendi", 39.815, 46.752, "city", "Former Stepanakert; retaken by Azerbaijan in September 2023.", ["Stepanakert"]],
    ["Lachin", 39.64, 46.546, "crossing", "Former corridor between Armenia and Karabakh."],
    ["Meghri", 38.903, 46.245, "crossing", "Syunik border town on the planned US-branded transit route (TRIPP).", ["Syunik", "Zangezur"]],
    ["Nakhchivan", 39.209, 45.412, "city", "Azerbaijani exclave the transit route would connect."],
  ],
  "kosovo-serbia": [
    ["Mitrovica", 42.891, 20.866, "city", "Divided city on the Ibar; flashpoint of the north."],
    ["Banjska", 42.99, 20.77, "front", "Village where a September 2023 armed attack killed a Kosovo police officer."],
    ["Pristina", 42.663, 21.166, "capital", "Kosovo's capital."],
    ["Belgrade", 44.787, 20.457, "capital", "Serbian capital."],
  ],
  transnistria: [
    ["Tiraspol", 46.84, 29.643, "capital", "Breakaway region's capital; Russian troops stationed."],
    ["Cobasna depot", 47.97, 29.19, "base", "Soviet-era ammunition depot guarded by Russian troops.", ["Cobasna", "Kolbasna"]],
    ["Bender", 46.831, 29.478, "city", "Security-zone city on the Dniester.", ["Tighina"]],
    ["Chisinau", 47.011, 28.863, "capital", "Moldovan capital.", ["Chișinău"]],
  ],
  "western-sahara": [
    ["Laayoune", 27.154, -13.203, "city", "Largest city; Moroccan-administered.", ["El Aaiún"]],
    ["Guerguerat", 21.37, -16.95, "crossing", "Crossing to Mauritania; 2020 incident ended the ceasefire.", ["Guerguerat crossing"]],
    ["Tindouf", 27.671, -8.147, "camp", "Algerian town hosting the Polisario and Sahrawi camps."],
    ["Dakhla", 23.684, -15.958, "port", "Southern port; Moroccan development hub."],
  ],
  "cyprus-buffer": [
    ["Nicosia", 35.176, 33.364, "capital", "Divided capital along the Green Line.", ["Lefkosia"]],
    ["Pyla", 35.01, 33.69, "front", "Mixed village inside the buffer zone; 2023 road incident."],
    ["Varosha", 35.12, 33.95, "city", "Fenced-off quarter of Famagusta, partly reopened by Turkish Cypriot authorities.", ["Famagusta"]],
  ],
  "baltic-suwalki": [
    ["Suwałki", 54.111, 22.931, "front", "Polish town at the gap between Kaliningrad and Belarus.", ["Suwalki"]],
    ["Baltiysk", 54.653, 19.914, "base", "Russian Baltic Fleet headquarters."],
    ["Kaliningrad", 54.707, 20.507, "base", "Russian exclave; Iskander deployment."],
    ["Grodno", 53.678, 23.83, "city", "Belarusian city on the corridor.", ["Hrodna"]],
    ["Vilnius", 54.687, 25.28, "capital", "Lithuanian capital, 30 km from Belarus."],
    ["Narva", 59.377, 28.19, "front", "Estonian border city facing Ivangorod."],
  ],
  hormuz: [
    ["Strait of Hormuz", 26.57, 56.25, "sea", "About 39 km wide at its narrowest; shipping lanes 3 km each way.", ["Hormuz"]],
    ["Bandar Abbas", 27.183, 56.266, "base", "Iran's main naval base and port on the strait."],
    ["Qeshm", 26.95, 56.27, "base", "Largest island in the strait; IRGC Navy positions."],
    ["Abu Musa", 25.87, 55.03, "base", "Iran-held island claimed by the UAE."],
    ["Greater Tunb", 26.26, 55.31, "base", "Iran-held island claimed by the UAE.", ["Tunb"]],
    ["Khasab", 26.18, 56.25, "port", "Omani Musandam port on the strait."],
    ["Jask", 25.644, 57.774, "port", "Iranian port outside the strait; oil export bypass terminal."],
    ["Khor Fakkan", 25.339, 56.356, "port", "UAE container port outside the strait."],
    ["Ras Tanura", 26.643, 50.159, "energy", "Saudi Aramco's main Gulf export terminal."],
  ],
  "bab-el-mandeb": [
    ["Perim Island", 12.656, 43.417, "base", "Island in the strait itself; taken by the Houthis in September 2026 (conf: med).", ["Perim", "Mayyun"]],
    ["Djibouti", 11.589, 43.145, "port", "Port and host to US, French, Chinese and other bases."],
    ["Camp Lemonnier", 11.547, 43.15, "base", "Main US base in Africa."],
    ["Assab", 13.009, 42.739, "port", "Eritrean port; former UAE base."],
    ["Berbera", 10.439, 45.014, "port", "Somaliland port on the Gulf of Aden."],
  ],
  "iran-nuclear": [
    ["Tehran", 35.689, 51.389, "capital", "Capital; struck repeatedly in the 2026 war."],
    ["Arak", 34.374, 49.241, "nuclear", "Heavy-water reactor site at Khondab.", ["Khondab"]],
    ["Bushehr NPP", 28.83, 50.886, "nuclear", "Russian-built power reactor.", ["Bushehr"]],
    ["Parchin", 35.52, 51.77, "nuclear", "Military complex linked to past weaponisation work."],
  ],
  "dprk-launch": [["Yongbyon", 39.797, 125.754, "nuclear", "Main nuclear complex: reactors and enrichment."]],
  somalia: [
    ["Mogadishu", 2.046, 45.318, "capital", "Capital; al-Shabaab attacks and mortar fire."],
    ["Kismayo", -0.358, 42.545, "port", "Jubaland's port capital."],
    ["Baidoa", 3.114, 43.65, "city", "South West state seat."],
    ["Beledweyne", 4.736, 45.204, "city", "Hiiraan; front of the 2022–23 offensive."],
    ["Jowhar", 2.781, 45.5, "front", "Middle Shabelle; al-Shabaab gains in 2025."],
    ["Bosaso", 11.284, 49.182, "port", "Puntland port; base for 2025 operations against IS-Somalia.", ["Bossaso"]],
    ["Hargeisa", 9.56, 44.065, "capital", "Somaliland's capital."],
  ],
  ethiopia: [
    ["Addis Ababa", 9.03, 38.74, "capital", "Capital."],
    ["Mekelle", 13.497, 39.475, "city", "Tigray capital; split TPLF leadership.", ["Mek'ele"]],
    ["Gondar", 12.6, 37.467, "front", "Amhara city in the Fano insurgency zone.", ["Gonder"]],
    ["Bahir Dar", 11.594, 37.39, "city", "Amhara regional capital."],
  ],
  venezuela: [
    ["Caracas", 10.488, -66.879, "capital", "Capital of the interim government."],
    ["Jose terminal", 10.1, -64.83, "energy", "Main crude export and upgrader complex.", ["Jose", "José"]],
    ["Paraguaná refinery", 11.75, -70.22, "energy", "Amuay–Cardón, one of the world's largest refining complexes.", ["Amuay", "Cardón"]],
    ["Maracaibo", 10.654, -71.64, "city", "Western oil city."],
    ["Puerto Cabello", 10.473, -68.012, "port", "Main container port and naval base."],
  ],
};

/** Places named in zone headlines rarely need two words to be unambiguous, but a few single names do. */
const NO_MATCH = new Set(["Uri", "Bol", "Mora", "Gao", "Bender", "Muse", "Jose terminal"]);

/** Places that define their zone. */
const KEY_SITES = new Set([
  "Pokrovsk", "Kostiantynivka", "Bakhmut", "Kupiansk", "Huliaipole", "Zaporizhzhia NPP", "Kherson", "Sevastopol",
  "Gaza City", "Rafah", "Khan Younis", "Dahiyeh", "Litani River",
  "Hodeidah", "Mokha", "Marib", "Aden",
  "El Fasher", "El Obeid", "Port Sudan", "Kadugli",
  "Goma", "Bukavu", "Uvira",
  "Sittwe", "Kyaukphyu", "Lashio",
  "Djibo", "Bamako",
  "Kinmen", "Scarborough Shoal", "Second Thomas Shoal",
  "Strait of Hormuz", "Bandar Abbas", "Perim Island",
  "Panmunjom", "Suwałki", "Mitrovica",
]);

const slug = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");

const kmApart = ([a1, b1]: LatLng, [a2, b2]: LatLng): number => {
  const r = Math.PI / 180;
  const x = (b2 - b1) * r * Math.cos(((a1 + a2) / 2) * r);
  const y = (a2 - a1) * r;
  return Math.hypot(x, y) * 6371;
};

/** Curated sites plus every zone node not already covered by one. */
export function zoneSites(zones: readonly HeatZone[]): Site[] {
  const out: Site[] = [];
  for (const z of zones) {
    const rows = SITES[z.id] ?? [];
    for (const [name, lat, lng, kind, note, aka] of rows) {
      out.push({
        id: `${z.id}/${slug(name)}`,
        zoneId: z.id,
        name,
        coord: [lat, lng],
        kind,
        note,
        ...(aka ? { aka } : {}),
        ...(NO_MATCH.has(name) ? { match: false } : {}),
        ...(KEY_SITES.has(name) ? { key: true } : {}),
      });
    }
    for (const n of z.nodes ?? []) {
      if (out.some((s) => s.zoneId === z.id && kmApart(s.coord, n.coord) < 8)) continue;
      out.push({
        id: `${z.id}/node-${slug(n.name)}`,
        zoneId: z.id,
        name: n.name,
        coord: n.coord,
        kind: "node",
        note: `Tracked node of ${z.name}.`,
        match: false,
      });
    }
  }
  return out;
}

export const SITE_ROWS = SITES;
